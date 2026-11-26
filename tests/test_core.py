"""Portable document, topology and plugin invariants independent of Qt."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from simulab_desktop.core.registry import ComponentRegistry
from simulab_desktop.core.documents import (
    load_document, new_workspace, parse_document, parse_project,
    save_document, serialize_document,
)
from simulab_desktop.core.history import History
from simulab_desktop.core.netlist import build_nets, validate_circuit
from simulab_desktop.core.editing import (
    add_component, clone_components, connect, delete_components,
    move_components, split_wire,
)


CATALOG = {
    "uno": {"name": "Uno", "category": "Microcontroller", "pins": [
        {"id": "D13", "electricalType": "bidirectional"},
        {"id": "5V", "electricalType": "power", "label": "5V"},
        {"id": "GND", "electricalType": "ground"},
        {"id": "DEBUG", "electricalType": "virtual-debug"},
    ], "defaultProperties": {"clockHz": 16000000}},
    "led": {"name": "LED", "category": "Actuator", "pins": [
        {"id": "A", "electricalType": "passive"},
        {"id": "K", "electricalType": "passive"},
    ], "defaultProperties": {"color": "#ff0000"}},
    "junction": {"name": "Junction", "category": "Connection", "pins": [
        {"id": "J", "electricalType": "passive"},
    ], "defaultProperties": {}},
    "servo": {"name": "Servo", "pins": [{"id": "PWM"}],
              "defaultProperties": {"minAngle": -90, "maxAngle": 90}},
}


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        catalog = self.root / "catalog.json"
        catalog.write_text(json.dumps(CATALOG), encoding="utf-8")
        self.registry = ComponentRegistry(catalog)
        self.workspace = new_workspace(self.registry)

    def tearDown(self):
        self.temp.cleanup()

    def part(self, kind, identity, x=0, y=0):
        part = self.registry.create(kind, x, y)
        part["id"] = identity
        return part

    def circuit(self):
        project = self.workspace["circuit"]
        project = add_component(project, self.part("uno", "board"))
        project = add_component(project, self.part("led", "lamp", 200, 0))
        return project

    def test_blank_workspace_and_roundtrip_strip_runtime_credentials(self):
        self.assertEqual([], self.workspace["circuit"]["components"])
        self.assertIn("void setup()", self.workspace["files"][0]["content"])
        self.workspace["token"] = "private"
        self.workspace["artifacts"] = ["firmware.hex"]
        self.workspace["files"][0]["extra"] = "transient"
        text = serialize_document(self.workspace, self.registry)
        self.assertNotIn("private", text)
        self.assertNotIn("artifacts", text)
        self.assertNotIn("transient", text)
        self.assertEqual(self.workspace["circuit"], parse_document(text, self.registry)["circuit"])

    def test_atomic_save_and_failed_save_retains_old_bytes(self):
        path = self.root / "document.simulab.json"
        save_document(path, self.workspace, self.registry)
        before = path.read_bytes()
        invalid = new_workspace(self.registry)
        invalid["circuit"]["components"] = [self.part("led", "bad")]
        invalid["circuit"]["components"][0]["position"]["x"] = float("inf")
        with self.assertRaises(ValueError):
            save_document(path, invalid, self.registry)
        self.assertEqual(before, path.read_bytes())
        self.assertEqual(self.workspace, load_document(path, self.registry))
        self.assertEqual([path.name], sorted(p.name for p in self.root.glob("*.simulab.json")))

    def test_interrupted_replace_preserves_destination_and_cleans_temporary(self):
        path=self.root/"saved.json"
        save_document(path,self.workspace,self.registry)
        original=path.read_bytes()
        with patch("simulab_desktop.core.documents.os.replace",side_effect=OSError("locked")):
            with self.assertRaises(OSError):
                save_document(path,self.workspace,self.registry)
        self.assertEqual(original,path.read_bytes())
        self.assertEqual([],list(self.root.glob("*.tmp")))

    def test_bare_circuit_wraps_and_all_schema_versions_open(self):
        for version in ("1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"):
            project = self.circuit()
            project["schemaVersion"] = version
            wrapped = parse_document(json.dumps(project), self.registry)
            self.assertEqual("1.0.0", wrapped["version"])
            self.assertEqual(version, wrapped["circuit"]["schemaVersion"])

    def test_malformed_bounded_and_nonfinite_documents_are_rejected(self):
        values = ["null", "[]", "{", '{"schemaVersion":"9"}']
        for text in values:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_project(text, self.registry)
        for value in (float("nan"), float("inf"), -100001, 100001, True, 10**1000):
            project = self.circuit()
            project["components"][0]["position"]["x"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                parse_project(json.dumps(project), self.registry)
        project = self.circuit()
        project["components"][0]["rotation"] = 45
        with self.assertRaises(ValueError):
            parse_project(json.dumps(project), self.registry)
        with self.assertRaises(ValueError):
            parse_document(" " * 3_100_001, self.registry)

    def test_component_and_property_limits_and_import_duplicate_wire(self):
        p=self.circuit()
        p["components"]=[self.part("led",f"p{i}") for i in range(1001)]
        with self.assertRaises(ValueError):
            parse_project(json.dumps(p),self.registry)
        p=self.circuit(); p["components"][0]["properties"]={f"p{i}":0 for i in range(51)}
        with self.assertRaises(ValueError):
            parse_project(json.dumps(p),self.registry)
        p=connect(self.circuit(),{"componentId":"board","pinId":"D13"},
                  {"componentId":"lamp","pinId":"A"},self.registry)
        wire=json.loads(json.dumps(p["wires"][0])); wire["id"]="another"
        wire["from"],wire["to"]=wire["to"],wire["from"]
        p["wires"].append(wire)
        with self.assertRaises(ValueError):
            parse_project(json.dumps(p),self.registry)

    def test_duplicate_ids_unknown_kinds_pins_and_self_wires_rejected(self):
        project = self.circuit()
        project["components"][1]["id"] = "board"
        with self.assertRaises(ValueError):
            parse_project(json.dumps(project), self.registry)
        project = self.circuit()
        project["components"][1]["kind"] = "missing-plugin"
        with self.assertRaises(ValueError):
            parse_project(json.dumps(project), self.registry)
        with self.assertRaises(ValueError):
            connect(self.circuit(), {"componentId":"board","pinId":"MISSING"},
                    {"componentId":"lamp","pinId":"A"}, self.registry)
        endpoint = {"componentId":"lamp","pinId":"A"}
        with self.assertRaises(ValueError):
            connect(self.circuit(), endpoint, endpoint, self.registry)

    def test_crossings_stay_separate_shared_pin_branches_join(self):
        p = self.circuit()
        p = add_component(p, self.part("led", "other", 200, 200))
        p = connect(p, {"componentId":"board","pinId":"D13"},
                    {"componentId":"lamp","pinId":"A"}, self.registry)
        p = connect(p, {"componentId":"board","pinId":"GND"},
                    {"componentId":"other","pinId":"K"}, self.registry)
        def same(a,b):
            return any(a in n["endpoints"] and b in n["endpoints"] for n in build_nets(p,self.registry))
        a={"componentId":"lamp","pinId":"A"}; b={"componentId":"other","pinId":"K"}
        self.assertFalse(same(a,b))
        p=connect(p,{"componentId":"board","pinId":"D13"},
                  {"componentId":"other","pinId":"A"},self.registry)
        self.assertTrue(same(a,{"componentId":"other","pinId":"A"}))

    def test_split_wire_preserves_net_and_creates_explicit_junction(self):
        p=connect(self.circuit(),{"componentId":"board","pinId":"D13"},
                  {"componentId":"lamp","pinId":"A"},self.registry)
        split=split_wire(p,p["wires"][0]["id"],100,100,self.registry)
        self.assertEqual(1,len(p["wires"]))
        self.assertEqual(2,len(split["wires"]))
        self.assertEqual("junction",split["components"][-1]["kind"])
        self.assertTrue(any(len(n["endpoints"])==3 for n in build_nets(split,self.registry)))

    def test_clone_delete_and_move_are_immutable(self):
        p=connect(self.circuit(),{"componentId":"board","pinId":"D13"},
                  {"componentId":"lamp","pinId":"A"},self.registry)
        cloned=clone_components(p,["board","lamp"],30,40)
        self.assertEqual(4,len(cloned["components"]))
        self.assertEqual(2,len(cloned["wires"]))
        self.assertEqual(4,len({c["id"] for c in cloned["components"]}))
        self.assertEqual({"x":30,"y":40},cloned["components"][2]["position"])
        moved=move_components(p,{"board":{"x":50,"y":70}})
        self.assertEqual({"x":0,"y":0},p["components"][0]["position"])
        self.assertEqual({"x":50,"y":70},moved["components"][0]["position"])
        deleted=delete_components(p,["lamp"])
        self.assertEqual([],deleted["wires"])
        self.assertEqual(1,len(deleted["components"]))

    def test_history_has_no_aliases_bounded_and_truncates_redo(self):
        initial={"value":0}; history=History(initial,limit=2)
        initial["value"]=99
        self.assertEqual(0,history.current["value"])
        history.commit({"value":1}); history.commit({"value":2}); history.commit({"value":3})
        self.assertEqual(2,history.undo()["value"])
        current=history.current; current["value"]=999
        self.assertEqual(2,history.current["value"])
        self.assertEqual(1,history.undo()["value"])
        self.assertIsNone(history.undo())
        history.redo(); history.commit({"value":8})
        self.assertFalse(history.can_redo)
        history.reset({"value":10}); self.assertFalse(history.can_undo)

    def test_plugins_keep_document_kind_but_map_only_valid_engine_alias(self):
        plugin=self.root/"my_led.py"
        plugin.write_text('def register(registry):\n    registry.register("custom-led", {"name":"Custom lamp","engineKind":"led","pins":[{"id":"A"},{"id":"K"}],"defaultProperties":{"color":"#00ff00"}})\n',encoding="utf-8")
        self.registry.load_plugins([plugin])
        p=add_component(self.workspace["circuit"],self.part("custom-led","custom"))
        self.assertEqual("custom-led",parse_project(json.dumps(p),self.registry)["components"][0]["kind"])
        mapped=self.registry.engine_project(p)
        self.assertEqual("led",mapped["components"][0]["kind"])
        self.assertEqual("custom-led",p["components"][0]["kind"])
        self.registry.register("no-model",{"pins":[{"id":"A"}],"defaultProperties":{}})
        with self.assertRaisesRegex(ValueError,"model|engineKind"):
            self.registry.engine_project(add_component(p,self.part("no-model","none")))
        self.registry.register("wrong-pins",{"engineKind":"led","pins":[{"id":"DIFFERENT"}],"defaultProperties":{}})
        with self.assertRaisesRegex(ValueError,"pin"):
            self.registry.engine_project(add_component(p,self.part("wrong-pins","wrong")))

    def test_failed_plugin_rolls_back_registered_definitions(self):
        plugin=self.root/"broken.py"
        plugin.write_text('def register(registry):\n    registry.register("partial", {"pins":[],"defaultProperties":{}})\n    raise RuntimeError("bad plugin")\n',encoding="utf-8")
        with self.assertRaisesRegex(ValueError,"bad plugin"):
            self.registry.load_plugins([plugin])
        self.assertNotIn("partial",self.registry.definitions)

    def test_real_catalogue_yield_shared_rails_and_all_examples_roundtrip(self):
        from simulab_desktop.core.registry import RESOURCES, create_registry
        if not (RESOURCES/"catalog.json").is_file():
            self.skipTest("Generated resources are not yet present")
        registry=create_registry()
        board=registry.create("yd-esp32-s3")
        p=add_component(new_workspace(registry)["circuit"],board,registry)
        rail={"componentId":board["id"],"pinId":"P1.22"}
        net=next(n for n in build_nets(p,registry) if rail in n["endpoints"])
        self.assertEqual({"P1.22","P2.1","P2.21","P2.22"},{e["pinId"] for e in net["endpoints"]})
        for path in (RESOURCES/"examples").glob("*.json"):
            doc=load_document(path,registry)
            self.assertEqual(doc,parse_document(serialize_document(doc,registry),registry))

    def test_source_validation_reserved_duplicates_and_breakpoints(self):
        for files in ([{"name":"con.h","content":""}],
                      [{"name":"sketch.ino","content":""},{"name":"SKETCH.ino","content":""}],
                      [{"name":"../sketch.ino","content":""}]):
            doc=new_workspace(self.registry); doc["files"]=files
            with self.assertRaises(ValueError):
                parse_document(json.dumps(doc),self.registry)
        doc=new_workspace(self.registry); doc["breakpoints"]={"missing.c":[1]}
        with self.assertRaises(ValueError):
            parse_document(json.dumps(doc),self.registry)

    def test_model_bounds_and_schema_virtual_gate(self):
        p=add_component(self.workspace["circuit"],self.part("servo","servo"))
        p["components"][0]["properties"]["minAngle"]=100
        with self.assertRaises(ValueError):
            parse_project(json.dumps(p),self.registry)
        p=self.circuit(); p["schemaVersion"]="1.0.0"
        p["wires"]=[{"id":"w","from":{"componentId":"board","pinId":"DEBUG"},
                      "to":{"componentId":"lamp","pinId":"A"},"color":"#123456","label":""}]
        with self.assertRaises(ValueError):
            parse_project(json.dumps(p),self.registry)

    def test_erc_reports_short_but_leaves_document_usable(self):
        p=connect(self.circuit(),{"componentId":"board","pinId":"5V"},
                  {"componentId":"board","pinId":"GND"},self.registry)
        self.assertTrue(any(i["severity"]=="error" and "short" in i["message"] for i in validate_circuit(p,self.registry)))


if __name__ == "__main__":
    unittest.main()
