var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../simulab-engine/node_modules/avr8js/dist/cjs/cpu/interrupt.js
var require_interrupt = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/cpu/interrupt.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.avrInterrupt = avrInterrupt;
    function avrInterrupt(cpu, addr) {
      const sp = cpu.dataView.getUint16(93, true);
      cpu.data[sp] = cpu.pc & 255;
      cpu.data[sp - 1] = cpu.pc >> 8 & 255;
      if (cpu.pc22Bits) {
        cpu.data[sp - 2] = cpu.pc >> 16 & 255;
      }
      cpu.dataView.setUint16(93, sp - (cpu.pc22Bits ? 3 : 2), true);
      cpu.data[95] &= 127;
      cpu.cycles += 2;
      cpu.pc = addr;
    }
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/cpu/cpu.js
var require_cpu = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/cpu/cpu.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.CPU = void 0;
    var interrupt_1 = require_interrupt();
    var registerSpace = 256;
    var MAX_INTERRUPTS = 128;
    var CPU2 = class {
      constructor(progMem, sramBytes = 8192) {
        this.progMem = progMem;
        this.sramBytes = sramBytes;
        this.data = new Uint8Array(this.sramBytes + registerSpace);
        this.data16 = new Uint16Array(this.data.buffer);
        this.dataView = new DataView(this.data.buffer);
        this.progBytes = new Uint8Array(this.progMem.buffer);
        this.readHooks = [];
        this.writeHooks = [];
        this.pendingInterrupts = new Array(MAX_INTERRUPTS);
        this.nextClockEvent = null;
        this.clockEventPool = [];
        this.pc22Bits = this.progBytes.length > 131072;
        this.gpioPorts = /* @__PURE__ */ new Set();
        this.gpioByPort = [];
        this.onWatchdogReset = () => {
        };
        this.pc = 0;
        this.cycles = 0;
        this.nextInterrupt = -1;
        this.maxInterrupt = 0;
        this.reset();
      }
      reset() {
        this.SP = this.data.length - 1;
        this.pc = 0;
        this.pendingInterrupts.fill(null);
        this.nextInterrupt = -1;
        this.nextClockEvent = null;
      }
      readData(addr) {
        if (addr >= 32 && this.readHooks[addr]) {
          return this.readHooks[addr](addr);
        }
        return this.data[addr];
      }
      writeData(addr, value, mask = 255) {
        const hook = this.writeHooks[addr];
        if (hook) {
          if (hook(value, this.data[addr], addr, mask)) {
            return;
          }
        }
        this.data[addr] = value;
      }
      get SP() {
        return this.dataView.getUint16(93, true);
      }
      set SP(value) {
        this.dataView.setUint16(93, value, true);
      }
      get SREG() {
        return this.data[95];
      }
      get interruptsEnabled() {
        return this.SREG & 128 ? true : false;
      }
      setInterruptFlag(interrupt) {
        const { flagRegister, flagMask, enableRegister, enableMask } = interrupt;
        if (interrupt.inverseFlag) {
          this.data[flagRegister] &= ~flagMask;
        } else {
          this.data[flagRegister] |= flagMask;
        }
        if (this.data[enableRegister] & enableMask) {
          this.queueInterrupt(interrupt);
        }
      }
      updateInterruptEnable(interrupt, registerValue) {
        const { enableMask, flagRegister, flagMask, inverseFlag } = interrupt;
        if (registerValue & enableMask) {
          const bitSet = this.data[flagRegister] & flagMask;
          if (inverseFlag ? !bitSet : bitSet) {
            this.queueInterrupt(interrupt);
          }
        } else {
          this.clearInterrupt(interrupt, false);
        }
      }
      queueInterrupt(interrupt) {
        const { address } = interrupt;
        this.pendingInterrupts[address] = interrupt;
        if (this.nextInterrupt === -1 || this.nextInterrupt > address) {
          this.nextInterrupt = address;
        }
        if (address > this.maxInterrupt) {
          this.maxInterrupt = address;
        }
      }
      clearInterrupt({ address, flagRegister, flagMask }, clearFlag = true) {
        if (clearFlag) {
          this.data[flagRegister] &= ~flagMask;
        }
        const { pendingInterrupts, maxInterrupt } = this;
        if (!pendingInterrupts[address]) {
          return;
        }
        pendingInterrupts[address] = null;
        if (this.nextInterrupt === address) {
          this.nextInterrupt = -1;
          for (let i = address + 1; i <= maxInterrupt; i++) {
            if (pendingInterrupts[i]) {
              this.nextInterrupt = i;
              break;
            }
          }
        }
      }
      clearInterruptByFlag(interrupt, registerValue) {
        const { flagRegister, flagMask } = interrupt;
        if (registerValue & flagMask) {
          this.data[flagRegister] &= ~flagMask;
          this.clearInterrupt(interrupt);
        }
      }
      addClockEvent(callback, cycles) {
        const { clockEventPool } = this;
        cycles = this.cycles + Math.max(1, cycles);
        const maybeEntry = clockEventPool.pop();
        const entry = maybeEntry !== null && maybeEntry !== void 0 ? maybeEntry : { cycles, callback, next: null };
        entry.cycles = cycles;
        entry.callback = callback;
        let { nextClockEvent: clockEvent } = this;
        let lastItem = null;
        while (clockEvent && clockEvent.cycles < cycles) {
          lastItem = clockEvent;
          clockEvent = clockEvent.next;
        }
        if (lastItem) {
          lastItem.next = entry;
          entry.next = clockEvent;
        } else {
          this.nextClockEvent = entry;
          entry.next = clockEvent;
        }
        return callback;
      }
      updateClockEvent(callback, cycles) {
        if (this.clearClockEvent(callback)) {
          this.addClockEvent(callback, cycles);
          return true;
        }
        return false;
      }
      clearClockEvent(callback) {
        let { nextClockEvent: clockEvent } = this;
        if (!clockEvent) {
          return false;
        }
        const { clockEventPool } = this;
        let lastItem = null;
        while (clockEvent) {
          if (clockEvent.callback === callback) {
            if (lastItem) {
              lastItem.next = clockEvent.next;
            } else {
              this.nextClockEvent = clockEvent.next;
            }
            if (clockEventPool.length < 10) {
              clockEventPool.push(clockEvent);
            }
            return true;
          }
          lastItem = clockEvent;
          clockEvent = clockEvent.next;
        }
        return false;
      }
      tick() {
        const { nextClockEvent } = this;
        if (nextClockEvent && nextClockEvent.cycles <= this.cycles) {
          nextClockEvent.callback();
          this.nextClockEvent = nextClockEvent.next;
          if (this.clockEventPool.length < 10) {
            this.clockEventPool.push(nextClockEvent);
          }
        }
        const { nextInterrupt } = this;
        if (this.interruptsEnabled && nextInterrupt >= 0) {
          const interrupt = this.pendingInterrupts[nextInterrupt];
          (0, interrupt_1.avrInterrupt)(this, interrupt.address);
          if (!interrupt.constant) {
            this.clearInterrupt(interrupt);
          }
        }
      }
    };
    exports.CPU = CPU2;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/cpu/instruction.js
var require_instruction = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/cpu/instruction.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.avrInstruction = avrInstruction2;
    function isTwoWordInstruction(opcode) {
      return (
        /* LDS */
        (opcode & 65039) === 36864 || /* STS */
        (opcode & 65039) === 37376 || /* CALL */
        (opcode & 65038) === 37902 || /* JMP */
        (opcode & 65038) === 37900
      );
    }
    function avrInstruction2(cpu) {
      const opcode = cpu.progMem[cpu.pc];
      if ((opcode & 64512) === 7168) {
        const d = cpu.data[(opcode & 496) >> 4];
        const r = cpu.data[opcode & 15 | (opcode & 512) >> 5];
        const sum = d + r + (cpu.data[95] & 1);
        const R = sum & 255;
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 192;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (R ^ r) & (d ^ R) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= sum & 256 ? 1 : 0;
        sreg |= 1 & (d & r | r & ~R | ~R & d) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 64512) === 3072) {
        const d = cpu.data[(opcode & 496) >> 4];
        const r = cpu.data[opcode & 15 | (opcode & 512) >> 5];
        const R = d + r & 255;
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 192;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (R ^ r) & (R ^ d) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= d + r & 256 ? 1 : 0;
        sreg |= 1 & (d & r | r & ~R | ~R & d) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 65280) === 38400) {
        const addr = 2 * ((opcode & 48) >> 4) + 24;
        const value = cpu.dataView.getUint16(addr, true);
        const R = value + (opcode & 15 | (opcode & 192) >> 2) & 65535;
        cpu.dataView.setUint16(addr, R, true);
        let sreg = cpu.data[95] & 224;
        sreg |= R ? 0 : 2;
        sreg |= 32768 & R ? 4 : 0;
        sreg |= ~value & R & 32768 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= ~R & value & 32768 ? 1 : 0;
        cpu.data[95] = sreg;
        cpu.cycles++;
      } else if ((opcode & 64512) === 8192) {
        const R = cpu.data[(opcode & 496) >> 4] & cpu.data[opcode & 15 | (opcode & 512) >> 5];
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 225;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 61440) === 28672) {
        const R = cpu.data[((opcode & 240) >> 4) + 16] & (opcode & 15 | (opcode & 3840) >> 4);
        cpu.data[((opcode & 240) >> 4) + 16] = R;
        let sreg = cpu.data[95] & 225;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 65039) === 37893) {
        const value = cpu.data[(opcode & 496) >> 4];
        const R = value >>> 1 | 128 & value;
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 224;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= value & 1;
        sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 65423) === 38024) {
        cpu.data[95] &= ~(1 << ((opcode & 112) >> 4));
      } else if ((opcode & 65032) === 63488) {
        const b = opcode & 7;
        const d = (opcode & 496) >> 4;
        cpu.data[d] = ~(1 << b) & cpu.data[d] | (cpu.data[95] >> 6 & 1) << b;
      } else if ((opcode & 64512) === 62464) {
        if (!(cpu.data[95] & 1 << (opcode & 7))) {
          cpu.pc = cpu.pc + (((opcode & 504) >> 3) - (opcode & 512 ? 64 : 0));
          cpu.cycles++;
        }
      } else if ((opcode & 64512) === 61440) {
        if (cpu.data[95] & 1 << (opcode & 7)) {
          cpu.pc = cpu.pc + (((opcode & 504) >> 3) - (opcode & 512 ? 64 : 0));
          cpu.cycles++;
        }
      } else if ((opcode & 65423) === 37896) {
        cpu.data[95] |= 1 << ((opcode & 112) >> 4);
      } else if ((opcode & 65032) === 64e3) {
        const d = cpu.data[(opcode & 496) >> 4];
        const b = opcode & 7;
        cpu.data[95] = cpu.data[95] & 191 | (d >> b & 1 ? 64 : 0);
      } else if ((opcode & 65038) === 37902) {
        const k = cpu.progMem[cpu.pc + 1] | (opcode & 1) << 16 | (opcode & 496) << 13;
        const ret = cpu.pc + 2;
        const sp = cpu.dataView.getUint16(93, true);
        const { pc22Bits } = cpu;
        cpu.data[sp] = 255 & ret;
        cpu.data[sp - 1] = ret >> 8 & 255;
        if (pc22Bits) {
          cpu.data[sp - 2] = ret >> 16 & 255;
        }
        cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
        cpu.pc = k - 1;
        cpu.cycles += pc22Bits ? 4 : 3;
      } else if ((opcode & 65280) === 38912) {
        const A = opcode & 248;
        const b = opcode & 7;
        const R = cpu.readData((A >> 3) + 32);
        const mask = 1 << b;
        cpu.writeData((A >> 3) + 32, R & ~mask, mask);
      } else if ((opcode & 65039) === 37888) {
        const d = (opcode & 496) >> 4;
        const R = 255 - cpu.data[d];
        cpu.data[d] = R;
        let sreg = cpu.data[95] & 225 | 1;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 64512) === 5120) {
        const val1 = cpu.data[(opcode & 496) >> 4];
        const val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
        const R = val1 - val2;
        let sreg = cpu.data[95] & 192;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= 0 !== ((val1 ^ val2) & (val1 ^ R) & 128) ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= val2 > val1 ? 1 : 0;
        sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 64512) === 1024) {
        const arg1 = cpu.data[(opcode & 496) >> 4];
        const arg2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
        let sreg = cpu.data[95];
        const r = arg1 - arg2 - (sreg & 1);
        sreg = sreg & 192 | (!r && sreg >> 1 & 1 ? 2 : 0) | (arg2 + (sreg & 1) > arg1 ? 1 : 0);
        sreg |= 128 & r ? 4 : 0;
        sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= 1 & (~arg1 & arg2 | arg2 & r | r & ~arg1) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 61440) === 12288) {
        const arg1 = cpu.data[((opcode & 240) >> 4) + 16];
        const arg2 = opcode & 15 | (opcode & 3840) >> 4;
        const r = arg1 - arg2;
        let sreg = cpu.data[95] & 192;
        sreg |= r ? 0 : 2;
        sreg |= 128 & r ? 4 : 0;
        sreg |= (arg1 ^ arg2) & (arg1 ^ r) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= arg2 > arg1 ? 1 : 0;
        sreg |= 1 & (~arg1 & arg2 | arg2 & r | r & ~arg1) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 64512) === 4096) {
        if (cpu.data[(opcode & 496) >> 4] === cpu.data[opcode & 15 | (opcode & 512) >> 5]) {
          const nextOpcode = cpu.progMem[cpu.pc + 1];
          const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
          cpu.pc += skipSize;
          cpu.cycles += skipSize;
        }
      } else if ((opcode & 65039) === 37898) {
        const value = cpu.data[(opcode & 496) >> 4];
        const R = value - 1;
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 225;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= 128 === value ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if (opcode === 38169) {
        const retAddr = cpu.pc + 1;
        const sp = cpu.dataView.getUint16(93, true);
        const eind = cpu.data[92];
        cpu.data[sp] = retAddr & 255;
        cpu.data[sp - 1] = retAddr >> 8 & 255;
        cpu.data[sp - 2] = retAddr >> 16 & 255;
        cpu.dataView.setUint16(93, sp - 3, true);
        cpu.pc = (eind << 16 | cpu.dataView.getUint16(30, true)) - 1;
        cpu.cycles += 3;
      } else if (opcode === 37913) {
        const eind = cpu.data[92];
        cpu.pc = (eind << 16 | cpu.dataView.getUint16(30, true)) - 1;
        cpu.cycles++;
      } else if (opcode === 38360) {
        const rampz = cpu.data[91];
        cpu.data[0] = cpu.progBytes[rampz << 16 | cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
      } else if ((opcode & 65039) === 36870) {
        const rampz = cpu.data[91];
        cpu.data[(opcode & 496) >> 4] = cpu.progBytes[rampz << 16 | cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
      } else if ((opcode & 65039) === 36871) {
        const rampz = cpu.data[91];
        const i = cpu.dataView.getUint16(30, true);
        cpu.data[(opcode & 496) >> 4] = cpu.progBytes[rampz << 16 | i];
        cpu.dataView.setUint16(30, i + 1, true);
        if (i === 65535) {
          cpu.data[91] = (rampz + 1) % (cpu.progBytes.length >> 16);
        }
        cpu.cycles += 2;
      } else if ((opcode & 64512) === 9216) {
        const R = cpu.data[(opcode & 496) >> 4] ^ cpu.data[opcode & 15 | (opcode & 512) >> 5];
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 225;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 65416) === 776) {
        const v1 = cpu.data[((opcode & 112) >> 4) + 16];
        const v2 = cpu.data[(opcode & 7) + 16];
        const R = v1 * v2 << 1;
        cpu.dataView.setUint16(0, R, true);
        cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (v1 * v2 & 32768 ? 1 : 0);
        cpu.cycles++;
      } else if ((opcode & 65416) === 896) {
        const v1 = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16);
        const v2 = cpu.dataView.getInt8((opcode & 7) + 16);
        const R = v1 * v2 << 1;
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (v1 * v2 & 32768 ? 1 : 0);
        cpu.cycles++;
      } else if ((opcode & 65416) === 904) {
        const v1 = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16);
        const v2 = cpu.data[(opcode & 7) + 16];
        const R = v1 * v2 << 1;
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 2 : 0) | (v1 * v2 & 32768 ? 1 : 0);
        cpu.cycles++;
      } else if (opcode === 38153) {
        const retAddr = cpu.pc + 1;
        const sp = cpu.dataView.getUint16(93, true);
        const { pc22Bits } = cpu;
        cpu.data[sp] = retAddr & 255;
        cpu.data[sp - 1] = retAddr >> 8 & 255;
        if (pc22Bits) {
          cpu.data[sp - 2] = retAddr >> 16 & 255;
        }
        cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
        cpu.pc = cpu.dataView.getUint16(30, true) - 1;
        cpu.cycles += pc22Bits ? 3 : 2;
      } else if (opcode === 37897) {
        cpu.pc = cpu.dataView.getUint16(30, true) - 1;
        cpu.cycles++;
      } else if ((opcode & 63488) === 45056) {
        const i = cpu.readData((opcode & 15 | (opcode & 1536) >> 5) + 32);
        cpu.data[(opcode & 496) >> 4] = i;
      } else if ((opcode & 65039) === 37891) {
        const d = cpu.data[(opcode & 496) >> 4];
        const r = d + 1 & 255;
        cpu.data[(opcode & 496) >> 4] = r;
        let sreg = cpu.data[95] & 225;
        sreg |= r ? 0 : 2;
        sreg |= 128 & r ? 4 : 0;
        sreg |= 127 === d ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 65038) === 37900) {
        cpu.pc = (cpu.progMem[cpu.pc + 1] | (opcode & 1) << 16 | (opcode & 496) << 13) - 1;
        cpu.cycles += 2;
      } else if ((opcode & 65039) === 37382) {
        const r = (opcode & 496) >> 4;
        const clear = cpu.data[r];
        const value = cpu.readData(cpu.dataView.getUint16(30, true));
        cpu.writeData(cpu.dataView.getUint16(30, true), value & 255 - clear);
        cpu.data[r] = value;
      } else if ((opcode & 65039) === 37381) {
        const r = (opcode & 496) >> 4;
        const set = cpu.data[r];
        const value = cpu.readData(cpu.dataView.getUint16(30, true));
        cpu.writeData(cpu.dataView.getUint16(30, true), value | set);
        cpu.data[r] = value;
      } else if ((opcode & 65039) === 37383) {
        const r = cpu.data[(opcode & 496) >> 4];
        const R = cpu.readData(cpu.dataView.getUint16(30, true));
        cpu.writeData(cpu.dataView.getUint16(30, true), r ^ R);
        cpu.data[(opcode & 496) >> 4] = R;
      } else if ((opcode & 61440) === 57344) {
        cpu.data[((opcode & 240) >> 4) + 16] = opcode & 15 | (opcode & 3840) >> 4;
      } else if ((opcode & 65039) === 36864) {
        cpu.cycles++;
        const value = cpu.readData(cpu.progMem[cpu.pc + 1]);
        cpu.data[(opcode & 496) >> 4] = value;
        cpu.pc++;
      } else if ((opcode & 65039) === 36876) {
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(26, true));
      } else if ((opcode & 65039) === 36877) {
        const x = cpu.dataView.getUint16(26, true);
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(x);
        cpu.dataView.setUint16(26, x + 1, true);
      } else if ((opcode & 65039) === 36878) {
        const x = cpu.dataView.getUint16(26, true) - 1;
        cpu.dataView.setUint16(26, x, true);
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(x);
      } else if ((opcode & 65039) === 32776) {
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(28, true));
      } else if ((opcode & 65039) === 36873) {
        const y = cpu.dataView.getUint16(28, true);
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(y);
        cpu.dataView.setUint16(28, y + 1, true);
      } else if ((opcode & 65039) === 36874) {
        const y = cpu.dataView.getUint16(28, true) - 1;
        cpu.dataView.setUint16(28, y, true);
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(y);
      } else if ((opcode & 53768) === 32776 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(28, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8));
      } else if ((opcode & 65039) === 32768) {
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(30, true));
      } else if ((opcode & 65039) === 36865) {
        const z = cpu.dataView.getUint16(30, true);
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(z);
        cpu.dataView.setUint16(30, z + 1, true);
      } else if ((opcode & 65039) === 36866) {
        const z = cpu.dataView.getUint16(30, true) - 1;
        cpu.dataView.setUint16(30, z, true);
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(z);
      } else if ((opcode & 53768) === 32768 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
        cpu.cycles++;
        cpu.data[(opcode & 496) >> 4] = cpu.readData(cpu.dataView.getUint16(30, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8));
      } else if (opcode === 38344) {
        cpu.data[0] = cpu.progBytes[cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
      } else if ((opcode & 65039) === 36868) {
        cpu.data[(opcode & 496) >> 4] = cpu.progBytes[cpu.dataView.getUint16(30, true)];
        cpu.cycles += 2;
      } else if ((opcode & 65039) === 36869) {
        const i = cpu.dataView.getUint16(30, true);
        cpu.data[(opcode & 496) >> 4] = cpu.progBytes[i];
        cpu.dataView.setUint16(30, i + 1, true);
        cpu.cycles += 2;
      } else if ((opcode & 65039) === 37894) {
        const value = cpu.data[(opcode & 496) >> 4];
        const R = value >>> 1;
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 224;
        sreg |= R ? 0 : 2;
        sreg |= value & 1;
        sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 64512) === 11264) {
        cpu.data[(opcode & 496) >> 4] = cpu.data[opcode & 15 | (opcode & 512) >> 5];
      } else if ((opcode & 65280) === 256) {
        const r2 = 2 * (opcode & 15);
        const d2 = 2 * ((opcode & 240) >> 4);
        cpu.data[d2] = cpu.data[r2];
        cpu.data[d2 + 1] = cpu.data[r2 + 1];
      } else if ((opcode & 64512) === 39936) {
        const R = cpu.data[(opcode & 496) >> 4] * cpu.data[opcode & 15 | (opcode & 512) >> 5];
        cpu.dataView.setUint16(0, R, true);
        cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0);
        cpu.cycles++;
      } else if ((opcode & 65280) === 512) {
        const R = cpu.dataView.getInt8(((opcode & 240) >> 4) + 16) * cpu.dataView.getInt8((opcode & 15) + 16);
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0);
        cpu.cycles++;
      } else if ((opcode & 65416) === 768) {
        const R = cpu.dataView.getInt8(((opcode & 112) >> 4) + 16) * cpu.data[(opcode & 7) + 16];
        cpu.dataView.setInt16(0, R, true);
        cpu.data[95] = cpu.data[95] & 252 | (65535 & R ? 0 : 2) | (32768 & R ? 1 : 0);
        cpu.cycles++;
      } else if ((opcode & 65039) === 37889) {
        const d = (opcode & 496) >> 4;
        const value = cpu.data[d];
        const R = 0 - value;
        cpu.data[d] = R;
        let sreg = cpu.data[95] & 192;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= 128 === R ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= R ? 1 : 0;
        sreg |= 1 & (R | value) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if (opcode === 0) {
      } else if ((opcode & 64512) === 10240) {
        const R = cpu.data[(opcode & 496) >> 4] | cpu.data[opcode & 15 | (opcode & 512) >> 5];
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 225;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 61440) === 24576) {
        const R = cpu.data[((opcode & 240) >> 4) + 16] | (opcode & 15 | (opcode & 3840) >> 4);
        cpu.data[((opcode & 240) >> 4) + 16] = R;
        let sreg = cpu.data[95] & 225;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 63488) === 47104) {
        cpu.writeData((opcode & 15 | (opcode & 1536) >> 5) + 32, cpu.data[(opcode & 496) >> 4]);
      } else if ((opcode & 65039) === 36879) {
        const value = cpu.dataView.getUint16(93, true) + 1;
        cpu.dataView.setUint16(93, value, true);
        cpu.data[(opcode & 496) >> 4] = cpu.data[value];
        cpu.cycles++;
      } else if ((opcode & 65039) === 37391) {
        const value = cpu.dataView.getUint16(93, true);
        cpu.data[value] = cpu.data[(opcode & 496) >> 4];
        cpu.dataView.setUint16(93, value - 1, true);
        cpu.cycles++;
      } else if ((opcode & 61440) === 53248) {
        const k = (opcode & 2047) - (opcode & 2048 ? 2048 : 0);
        const retAddr = cpu.pc + 1;
        const sp = cpu.dataView.getUint16(93, true);
        const { pc22Bits } = cpu;
        cpu.data[sp] = 255 & retAddr;
        cpu.data[sp - 1] = retAddr >> 8 & 255;
        if (pc22Bits) {
          cpu.data[sp - 2] = retAddr >> 16 & 255;
        }
        cpu.dataView.setUint16(93, sp - (pc22Bits ? 3 : 2), true);
        cpu.pc += k;
        cpu.cycles += pc22Bits ? 3 : 2;
      } else if (opcode === 38152) {
        const { pc22Bits } = cpu;
        const i = cpu.dataView.getUint16(93, true) + (pc22Bits ? 3 : 2);
        cpu.dataView.setUint16(93, i, true);
        cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1;
        if (pc22Bits) {
          cpu.pc |= cpu.data[i - 2] << 16;
        }
        cpu.cycles += pc22Bits ? 4 : 3;
      } else if (opcode === 38168) {
        const { pc22Bits } = cpu;
        const i = cpu.dataView.getUint16(93, true) + (pc22Bits ? 3 : 2);
        cpu.dataView.setUint16(93, i, true);
        cpu.pc = (cpu.data[i - 1] << 8) + cpu.data[i] - 1;
        if (pc22Bits) {
          cpu.pc |= cpu.data[i - 2] << 16;
        }
        cpu.cycles += pc22Bits ? 4 : 3;
        cpu.data[95] |= 128;
      } else if ((opcode & 61440) === 49152) {
        cpu.pc = cpu.pc + ((opcode & 2047) - (opcode & 2048 ? 2048 : 0));
        cpu.cycles++;
      } else if ((opcode & 65039) === 37895) {
        const d = cpu.data[(opcode & 496) >> 4];
        const r = d >>> 1 | (cpu.data[95] & 1) << 7;
        cpu.data[(opcode & 496) >> 4] = r;
        let sreg = cpu.data[95] & 224;
        sreg |= r ? 0 : 2;
        sreg |= 128 & r ? 4 : 0;
        sreg |= 1 & d ? 1 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg & 1 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 64512) === 2048) {
        const val1 = cpu.data[(opcode & 496) >> 4];
        const val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
        let sreg = cpu.data[95];
        const R = val1 - val2 - (sreg & 1);
        cpu.data[(opcode & 496) >> 4] = R;
        sreg = sreg & 192 | (!R && sreg >> 1 & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0);
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 61440) === 16384) {
        const val1 = cpu.data[((opcode & 240) >> 4) + 16];
        const val2 = opcode & 15 | (opcode & 3840) >> 4;
        let sreg = cpu.data[95];
        const R = val1 - val2 - (sreg & 1);
        cpu.data[((opcode & 240) >> 4) + 16] = R;
        sreg = sreg & 192 | (!R && sreg >> 1 & 1 ? 2 : 0) | (val2 + (sreg & 1) > val1 ? 1 : 0);
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 65280) === 39424) {
        const target = ((opcode & 248) >> 3) + 32;
        const mask = 1 << (opcode & 7);
        cpu.writeData(target, cpu.readData(target) | mask, mask);
        cpu.cycles++;
      } else if ((opcode & 65280) === 39168) {
        const value = cpu.readData(((opcode & 248) >> 3) + 32);
        if (!(value & 1 << (opcode & 7))) {
          const nextOpcode = cpu.progMem[cpu.pc + 1];
          const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
          cpu.cycles += skipSize;
          cpu.pc += skipSize;
        }
      } else if ((opcode & 65280) === 39680) {
        const value = cpu.readData(((opcode & 248) >> 3) + 32);
        if (value & 1 << (opcode & 7)) {
          const nextOpcode = cpu.progMem[cpu.pc + 1];
          const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
          cpu.cycles += skipSize;
          cpu.pc += skipSize;
        }
      } else if ((opcode & 65280) === 38656) {
        const i = 2 * ((opcode & 48) >> 4) + 24;
        const a = cpu.dataView.getUint16(i, true);
        const l = opcode & 15 | (opcode & 192) >> 2;
        const R = a - l;
        cpu.dataView.setUint16(i, R, true);
        let sreg = cpu.data[95] & 192;
        sreg |= R ? 0 : 2;
        sreg |= 32768 & R ? 4 : 0;
        sreg |= a & ~R & 32768 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= l > a ? 1 : 0;
        sreg |= 1 & (~a & l | l & R | R & ~a) ? 32 : 0;
        cpu.data[95] = sreg;
        cpu.cycles++;
      } else if ((opcode & 65032) === 64512) {
        if (!(cpu.data[(opcode & 496) >> 4] & 1 << (opcode & 7))) {
          const nextOpcode = cpu.progMem[cpu.pc + 1];
          const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
          cpu.cycles += skipSize;
          cpu.pc += skipSize;
        }
      } else if ((opcode & 65032) === 65024) {
        if (cpu.data[(opcode & 496) >> 4] & 1 << (opcode & 7)) {
          const nextOpcode = cpu.progMem[cpu.pc + 1];
          const skipSize = isTwoWordInstruction(nextOpcode) ? 2 : 1;
          cpu.cycles += skipSize;
          cpu.pc += skipSize;
        }
      } else if (opcode === 38280) {
      } else if (opcode === 38376) {
      } else if (opcode === 38392) {
      } else if ((opcode & 65039) === 37376) {
        const value = cpu.data[(opcode & 496) >> 4];
        const addr = cpu.progMem[cpu.pc + 1];
        cpu.writeData(addr, value);
        cpu.pc++;
        cpu.cycles++;
      } else if ((opcode & 65039) === 37388) {
        cpu.writeData(cpu.dataView.getUint16(26, true), cpu.data[(opcode & 496) >> 4]);
        cpu.cycles++;
      } else if ((opcode & 65039) === 37389) {
        const x = cpu.dataView.getUint16(26, true);
        cpu.writeData(x, cpu.data[(opcode & 496) >> 4]);
        cpu.dataView.setUint16(26, x + 1, true);
        cpu.cycles++;
      } else if ((opcode & 65039) === 37390) {
        const i = cpu.data[(opcode & 496) >> 4];
        const x = cpu.dataView.getUint16(26, true) - 1;
        cpu.dataView.setUint16(26, x, true);
        cpu.writeData(x, i);
        cpu.cycles++;
      } else if ((opcode & 65039) === 33288) {
        cpu.writeData(cpu.dataView.getUint16(28, true), cpu.data[(opcode & 496) >> 4]);
        cpu.cycles++;
      } else if ((opcode & 65039) === 37385) {
        const i = cpu.data[(opcode & 496) >> 4];
        const y = cpu.dataView.getUint16(28, true);
        cpu.writeData(y, i);
        cpu.dataView.setUint16(28, y + 1, true);
        cpu.cycles++;
      } else if ((opcode & 65039) === 37386) {
        const i = cpu.data[(opcode & 496) >> 4];
        const y = cpu.dataView.getUint16(28, true) - 1;
        cpu.dataView.setUint16(28, y, true);
        cpu.writeData(y, i);
        cpu.cycles++;
      } else if ((opcode & 53768) === 33288 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
        cpu.writeData(cpu.dataView.getUint16(28, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8), cpu.data[(opcode & 496) >> 4]);
        cpu.cycles++;
      } else if ((opcode & 65039) === 33280) {
        cpu.writeData(cpu.dataView.getUint16(30, true), cpu.data[(opcode & 496) >> 4]);
        cpu.cycles++;
      } else if ((opcode & 65039) === 37377) {
        const z = cpu.dataView.getUint16(30, true);
        cpu.writeData(z, cpu.data[(opcode & 496) >> 4]);
        cpu.dataView.setUint16(30, z + 1, true);
        cpu.cycles++;
      } else if ((opcode & 65039) === 37378) {
        const i = cpu.data[(opcode & 496) >> 4];
        const z = cpu.dataView.getUint16(30, true) - 1;
        cpu.dataView.setUint16(30, z, true);
        cpu.writeData(z, i);
        cpu.cycles++;
      } else if ((opcode & 53768) === 33280 && opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8) {
        cpu.writeData(cpu.dataView.getUint16(30, true) + (opcode & 7 | (opcode & 3072) >> 7 | (opcode & 8192) >> 8), cpu.data[(opcode & 496) >> 4]);
        cpu.cycles++;
      } else if ((opcode & 64512) === 6144) {
        const val1 = cpu.data[(opcode & 496) >> 4];
        const val2 = cpu.data[opcode & 15 | (opcode & 512) >> 5];
        const R = val1 - val2;
        cpu.data[(opcode & 496) >> 4] = R;
        let sreg = cpu.data[95] & 192;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= val2 > val1 ? 1 : 0;
        sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 61440) === 20480) {
        const val1 = cpu.data[((opcode & 240) >> 4) + 16];
        const val2 = opcode & 15 | (opcode & 3840) >> 4;
        const R = val1 - val2;
        cpu.data[((opcode & 240) >> 4) + 16] = R;
        let sreg = cpu.data[95] & 192;
        sreg |= R ? 0 : 2;
        sreg |= 128 & R ? 4 : 0;
        sreg |= (val1 ^ val2) & (val1 ^ R) & 128 ? 8 : 0;
        sreg |= sreg >> 2 & 1 ^ sreg >> 3 & 1 ? 16 : 0;
        sreg |= val2 > val1 ? 1 : 0;
        sreg |= 1 & (~val1 & val2 | val2 & R | R & ~val1) ? 32 : 0;
        cpu.data[95] = sreg;
      } else if ((opcode & 65039) === 37890) {
        const d = (opcode & 496) >> 4;
        const i = cpu.data[d];
        cpu.data[d] = (15 & i) << 4 | (240 & i) >>> 4;
      } else if (opcode === 38312) {
        cpu.onWatchdogReset();
      } else if ((opcode & 65039) === 37380) {
        const r = (opcode & 496) >> 4;
        const val1 = cpu.data[r];
        const val2 = cpu.data[cpu.dataView.getUint16(30, true)];
        cpu.data[cpu.dataView.getUint16(30, true)] = val1;
        cpu.data[r] = val2;
      }
      cpu.pc = (cpu.pc + 1) % cpu.progMem.length;
      cpu.cycles++;
    }
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/adc.js
var require_adc = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/adc.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRADC = exports.adcConfig = exports.atmega328Channels = exports.ADCMuxInputType = exports.ADCReference = void 0;
    var ADCReference;
    (function(ADCReference2) {
      ADCReference2[ADCReference2["AVCC"] = 0] = "AVCC";
      ADCReference2[ADCReference2["AREF"] = 1] = "AREF";
      ADCReference2[ADCReference2["Internal1V1"] = 2] = "Internal1V1";
      ADCReference2[ADCReference2["Internal2V56"] = 3] = "Internal2V56";
      ADCReference2[ADCReference2["Reserved"] = 4] = "Reserved";
    })(ADCReference || (exports.ADCReference = ADCReference = {}));
    var ADCMuxInputType;
    (function(ADCMuxInputType2) {
      ADCMuxInputType2[ADCMuxInputType2["SingleEnded"] = 0] = "SingleEnded";
      ADCMuxInputType2[ADCMuxInputType2["Differential"] = 1] = "Differential";
      ADCMuxInputType2[ADCMuxInputType2["Constant"] = 2] = "Constant";
      ADCMuxInputType2[ADCMuxInputType2["Temperature"] = 3] = "Temperature";
    })(ADCMuxInputType || (exports.ADCMuxInputType = ADCMuxInputType = {}));
    exports.atmega328Channels = {
      0: { type: ADCMuxInputType.SingleEnded, channel: 0 },
      1: { type: ADCMuxInputType.SingleEnded, channel: 1 },
      2: { type: ADCMuxInputType.SingleEnded, channel: 2 },
      3: { type: ADCMuxInputType.SingleEnded, channel: 3 },
      4: { type: ADCMuxInputType.SingleEnded, channel: 4 },
      5: { type: ADCMuxInputType.SingleEnded, channel: 5 },
      6: { type: ADCMuxInputType.SingleEnded, channel: 6 },
      7: { type: ADCMuxInputType.SingleEnded, channel: 7 },
      8: { type: ADCMuxInputType.Temperature },
      14: { type: ADCMuxInputType.Constant, voltage: 1.1 },
      15: { type: ADCMuxInputType.Constant, voltage: 0 }
    };
    var fallbackMuxInput = {
      type: ADCMuxInputType.Constant,
      voltage: 0
    };
    exports.adcConfig = {
      ADMUX: 124,
      ADCSRA: 122,
      ADCSRB: 123,
      ADCL: 120,
      ADCH: 121,
      DIDR0: 126,
      adcInterrupt: 42,
      numChannels: 8,
      muxInputMask: 15,
      muxChannels: exports.atmega328Channels,
      adcReferences: [
        ADCReference.AREF,
        ADCReference.AVCC,
        ADCReference.Reserved,
        ADCReference.Internal1V1
      ]
    };
    var ADPS_MASK = 7;
    var ADIE = 8;
    var ADIF = 16;
    var ADSC = 64;
    var ADEN = 128;
    var MUX_MASK = 31;
    var ADLAR = 32;
    var MUX5 = 8;
    var REFS2 = 8;
    var REFS_MASK = 3;
    var REFS_SHIFT = 6;
    var AVRADC = class {
      constructor(cpu, config) {
        this.cpu = cpu;
        this.config = config;
        this.channelValues = new Array(this.config.numChannels);
        this.avcc = 5;
        this.aref = 5;
        this.onADCRead = (input) => {
          var _a;
          let voltage = 0;
          switch (input.type) {
            case ADCMuxInputType.Constant:
              voltage = input.voltage;
              break;
            case ADCMuxInputType.SingleEnded:
              voltage = (_a = this.channelValues[input.channel]) !== null && _a !== void 0 ? _a : 0;
              break;
            case ADCMuxInputType.Differential:
              voltage = input.gain * ((this.channelValues[input.positiveChannel] || 0) - (this.channelValues[input.negativeChannel] || 0));
              break;
            case ADCMuxInputType.Temperature:
              voltage = 0.378125;
              break;
          }
          const rawValue = voltage / this.referenceVoltage * 1024;
          const result = Math.min(Math.max(Math.floor(rawValue), 0), 1023);
          this.cpu.addClockEvent(() => this.completeADCRead(result), this.sampleCycles);
        };
        this.converting = false;
        this.conversionCycles = 25;
        this.ADC = {
          address: this.config.adcInterrupt,
          flagRegister: this.config.ADCSRA,
          flagMask: ADIF,
          enableRegister: this.config.ADCSRA,
          enableMask: ADIE
        };
        cpu.writeHooks[config.ADCSRA] = (value, oldValue) => {
          var _a;
          if (value & ADEN && !(oldValue & ADEN)) {
            this.conversionCycles = 25;
          }
          cpu.data[config.ADCSRA] = value;
          cpu.updateInterruptEnable(this.ADC, value);
          if (!this.converting && value & ADSC) {
            if (!(value & ADEN)) {
              this.cpu.addClockEvent(() => this.completeADCRead(0), this.sampleCycles);
              return true;
            }
            let channel = this.cpu.data[this.config.ADMUX] & MUX_MASK;
            if (cpu.data[config.ADCSRB] & MUX5) {
              channel |= 32;
            }
            channel &= config.muxInputMask;
            const muxInput = (_a = config.muxChannels[channel]) !== null && _a !== void 0 ? _a : fallbackMuxInput;
            this.converting = true;
            this.onADCRead(muxInput);
            return true;
          }
        };
      }
      completeADCRead(value) {
        const { ADCL, ADCH, ADMUX, ADCSRA } = this.config;
        this.converting = false;
        this.conversionCycles = 13;
        if (this.cpu.data[ADMUX] & ADLAR) {
          this.cpu.data[ADCL] = value << 6 & 255;
          this.cpu.data[ADCH] = value >> 2;
        } else {
          this.cpu.data[ADCL] = value & 255;
          this.cpu.data[ADCH] = value >> 8 & 3;
        }
        this.cpu.data[ADCSRA] &= ~ADSC;
        this.cpu.setInterruptFlag(this.ADC);
      }
      get prescaler() {
        const { ADCSRA } = this.config;
        const adcsra = this.cpu.data[ADCSRA];
        const adps = adcsra & ADPS_MASK;
        switch (adps) {
          case 0:
          case 1:
            return 2;
          case 2:
            return 4;
          case 3:
            return 8;
          case 4:
            return 16;
          case 5:
            return 32;
          case 6:
            return 64;
          case 7:
          default:
            return 128;
        }
      }
      get referenceVoltageType() {
        var _a;
        const { ADMUX, adcReferences } = this.config;
        let refs = this.cpu.data[ADMUX] >> REFS_SHIFT & REFS_MASK;
        if (adcReferences.length > 4 && this.cpu.data[ADMUX] & REFS2) {
          refs |= 4;
        }
        return (_a = adcReferences[refs]) !== null && _a !== void 0 ? _a : ADCReference.Reserved;
      }
      get referenceVoltage() {
        switch (this.referenceVoltageType) {
          case ADCReference.AVCC:
            return this.avcc;
          case ADCReference.AREF:
            return this.aref;
          case ADCReference.Internal1V1:
            return 1.1;
          case ADCReference.Internal2V56:
            return 2.56;
          default:
            return this.avcc;
        }
      }
      get sampleCycles() {
        return this.conversionCycles * this.prescaler;
      }
    };
    exports.AVRADC = AVRADC;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/clock.js
var require_clock = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/clock.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRClock = exports.clockConfig = void 0;
    var CLKPCE = 128;
    exports.clockConfig = {
      CLKPR: 97
    };
    var prescalers = [
      1,
      2,
      4,
      8,
      16,
      32,
      64,
      128,
      256,
      // The following values are "reserved" according to the datasheet, so we measured
      // with a scope to figure them out (on ATmega328p)
      2,
      4,
      8,
      16,
      32,
      64,
      128
    ];
    var AVRClock = class {
      constructor(cpu, baseFreqHz, config = exports.clockConfig) {
        this.cpu = cpu;
        this.baseFreqHz = baseFreqHz;
        this.config = config;
        this.clockEnabledCycles = 0;
        this.prescalerValue = 1;
        this.cyclesDelta = 0;
        this.cpu.writeHooks[this.config.CLKPR] = (clkpr) => {
          if ((!this.clockEnabledCycles || this.clockEnabledCycles < cpu.cycles) && clkpr === CLKPCE) {
            this.clockEnabledCycles = this.cpu.cycles + 4;
          } else if (this.clockEnabledCycles && this.clockEnabledCycles >= cpu.cycles) {
            this.clockEnabledCycles = 0;
            const index = clkpr & 15;
            const oldPrescaler = this.prescalerValue;
            this.prescalerValue = prescalers[index];
            this.cpu.data[this.config.CLKPR] = index;
            if (oldPrescaler !== this.prescalerValue) {
              this.cyclesDelta = (cpu.cycles + this.cyclesDelta) * (oldPrescaler / this.prescalerValue) - cpu.cycles;
            }
          }
          return true;
        };
      }
      get frequency() {
        return this.baseFreqHz / this.prescalerValue;
      }
      get prescaler() {
        return this.prescalerValue;
      }
      get timeNanos() {
        return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e9;
      }
      get timeMicros() {
        return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e6;
      }
      get timeMillis() {
        return (this.cpu.cycles + this.cyclesDelta) / this.frequency * 1e3;
      }
    };
    exports.AVRClock = AVRClock;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/eeprom.js
var require_eeprom = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/eeprom.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVREEPROM = exports.eepromConfig = exports.EEPROMMemoryBackend = void 0;
    var EEPROMMemoryBackend = class {
      constructor(size) {
        this.memory = new Uint8Array(size);
        this.memory.fill(255);
      }
      readMemory(addr) {
        return this.memory[addr];
      }
      writeMemory(addr, value) {
        this.memory[addr] &= value;
      }
      eraseMemory(addr) {
        this.memory[addr] = 255;
      }
    };
    exports.EEPROMMemoryBackend = EEPROMMemoryBackend;
    exports.eepromConfig = {
      eepromReadyInterrupt: 44,
      EECR: 63,
      EEDR: 64,
      EEARL: 65,
      EEARH: 66,
      eraseCycles: 28800,
      // 1.8ms at 16MHz
      writeCycles: 28800
      // 1.8ms at 16MHz
    };
    var EERE = 1 << 0;
    var EEPE = 1 << 1;
    var EEMPE = 1 << 2;
    var EERIE = 1 << 3;
    var EEPM0 = 1 << 4;
    var EEPM1 = 1 << 5;
    var EECR_WRITE_MASK = EEPE | EEMPE | EERIE | EEPM0 | EEPM1;
    var AVREEPROM = class {
      constructor(cpu, backend, config = exports.eepromConfig) {
        this.cpu = cpu;
        this.backend = backend;
        this.config = config;
        this.writeEnabledCycles = 0;
        this.writeCompleteCycles = 0;
        this.EER = {
          address: this.config.eepromReadyInterrupt,
          flagRegister: this.config.EECR,
          flagMask: EEPE,
          enableRegister: this.config.EECR,
          enableMask: EERIE,
          constant: true,
          inverseFlag: true
        };
        this.cpu.writeHooks[this.config.EECR] = (eecr) => {
          const { EEARH, EEARL, EECR, EEDR } = this.config;
          const addr = this.cpu.data[EEARH] << 8 | this.cpu.data[EEARL];
          this.cpu.data[EECR] = this.cpu.data[EECR] & ~EECR_WRITE_MASK | eecr & EECR_WRITE_MASK;
          this.cpu.updateInterruptEnable(this.EER, eecr);
          if (eecr & EERE) {
            this.cpu.clearInterrupt(this.EER);
          }
          if (eecr & EEMPE) {
            const eempeCycles = 4;
            this.writeEnabledCycles = this.cpu.cycles + eempeCycles;
            this.cpu.addClockEvent(() => {
              this.cpu.data[EECR] &= ~EEMPE;
            }, eempeCycles);
          }
          if (eecr & EERE) {
            this.cpu.data[EEDR] = this.backend.readMemory(addr);
            this.cpu.cycles += 4;
            return true;
          }
          if (eecr & EEPE) {
            if (this.cpu.cycles >= this.writeEnabledCycles) {
              this.cpu.data[EECR] &= ~EEPE;
              return true;
            }
            if (this.cpu.cycles < this.writeCompleteCycles) {
              return true;
            }
            const eedr = this.cpu.data[EEDR];
            this.writeCompleteCycles = this.cpu.cycles;
            if (!(eecr & EEPM1)) {
              this.backend.eraseMemory(addr);
              this.writeCompleteCycles += this.config.eraseCycles;
            }
            if (!(eecr & EEPM0)) {
              this.backend.writeMemory(addr, eedr);
              this.writeCompleteCycles += this.config.writeCycles;
            }
            this.cpu.data[EECR] |= EEPE;
            this.cpu.addClockEvent(() => {
              this.cpu.setInterruptFlag(this.EER);
            }, this.writeCompleteCycles - this.cpu.cycles);
            this.cpu.cycles += 2;
          }
          return true;
        };
      }
    };
    exports.AVREEPROM = AVREEPROM;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/gpio.js
var require_gpio = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/gpio.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRIOPort = exports.PinOverrideMode = exports.PinState = exports.portLConfig = exports.portKConfig = exports.portJConfig = exports.portHConfig = exports.portGConfig = exports.portFConfig = exports.portEConfig = exports.portDConfig = exports.portCConfig = exports.portBConfig = exports.portAConfig = exports.PCINT2 = exports.PCINT1 = exports.PCINT0 = exports.INT1 = exports.INT0 = void 0;
    exports.INT0 = {
      EICR: 105,
      EIMSK: 61,
      EIFR: 60,
      index: 0,
      iscOffset: 0,
      interrupt: 2
    };
    exports.INT1 = {
      EICR: 105,
      EIMSK: 61,
      EIFR: 60,
      index: 1,
      iscOffset: 2,
      interrupt: 4
    };
    exports.PCINT0 = {
      PCIE: 0,
      PCICR: 104,
      PCIFR: 59,
      PCMSK: 107,
      pinChangeInterrupt: 6,
      mask: 255,
      offset: 0
    };
    exports.PCINT1 = {
      PCIE: 1,
      PCICR: 104,
      PCIFR: 59,
      PCMSK: 108,
      pinChangeInterrupt: 8,
      mask: 255,
      offset: 0
    };
    exports.PCINT2 = {
      PCIE: 2,
      PCICR: 104,
      PCIFR: 59,
      PCMSK: 109,
      pinChangeInterrupt: 10,
      mask: 255,
      offset: 0
    };
    exports.portAConfig = {
      PIN: 32,
      DDR: 33,
      PORT: 34,
      externalInterrupts: []
    };
    exports.portBConfig = {
      PIN: 35,
      DDR: 36,
      PORT: 37,
      // Interrupt settings
      pinChange: exports.PCINT0,
      externalInterrupts: []
    };
    exports.portCConfig = {
      PIN: 38,
      DDR: 39,
      PORT: 40,
      // Interrupt settings
      pinChange: exports.PCINT1,
      externalInterrupts: []
    };
    exports.portDConfig = {
      PIN: 41,
      DDR: 42,
      PORT: 43,
      // Interrupt settings
      pinChange: exports.PCINT2,
      externalInterrupts: [null, null, exports.INT0, exports.INT1]
    };
    exports.portEConfig = {
      PIN: 44,
      DDR: 45,
      PORT: 46,
      externalInterrupts: []
    };
    exports.portFConfig = {
      PIN: 47,
      DDR: 48,
      PORT: 49,
      externalInterrupts: []
    };
    exports.portGConfig = {
      PIN: 50,
      DDR: 51,
      PORT: 52,
      externalInterrupts: []
    };
    exports.portHConfig = {
      PIN: 256,
      DDR: 257,
      PORT: 258,
      externalInterrupts: []
    };
    exports.portJConfig = {
      PIN: 259,
      DDR: 260,
      PORT: 261,
      externalInterrupts: []
    };
    exports.portKConfig = {
      PIN: 262,
      DDR: 263,
      PORT: 264,
      externalInterrupts: []
    };
    exports.portLConfig = {
      PIN: 265,
      DDR: 266,
      PORT: 267,
      externalInterrupts: []
    };
    var PinState2;
    (function(PinState3) {
      PinState3[PinState3["Low"] = 0] = "Low";
      PinState3[PinState3["High"] = 1] = "High";
      PinState3[PinState3["Input"] = 2] = "Input";
      PinState3[PinState3["InputPullUp"] = 3] = "InputPullUp";
    })(PinState2 || (exports.PinState = PinState2 = {}));
    var PinOverrideMode;
    (function(PinOverrideMode2) {
      PinOverrideMode2[PinOverrideMode2["None"] = 0] = "None";
      PinOverrideMode2[PinOverrideMode2["Enable"] = 1] = "Enable";
      PinOverrideMode2[PinOverrideMode2["Set"] = 2] = "Set";
      PinOverrideMode2[PinOverrideMode2["Clear"] = 3] = "Clear";
      PinOverrideMode2[PinOverrideMode2["Toggle"] = 4] = "Toggle";
    })(PinOverrideMode || (exports.PinOverrideMode = PinOverrideMode = {}));
    var InterruptMode;
    (function(InterruptMode2) {
      InterruptMode2[InterruptMode2["LowLevel"] = 0] = "LowLevel";
      InterruptMode2[InterruptMode2["Change"] = 1] = "Change";
      InterruptMode2[InterruptMode2["FallingEdge"] = 2] = "FallingEdge";
      InterruptMode2[InterruptMode2["RisingEdge"] = 3] = "RisingEdge";
    })(InterruptMode || (InterruptMode = {}));
    var AVRIOPort2 = class {
      constructor(cpu, portConfig) {
        var _a, _b, _c, _d;
        this.cpu = cpu;
        this.portConfig = portConfig;
        this.externalClockListeners = [];
        this.listeners = [];
        this.pinValue = 0;
        this.overrideMask = 255;
        this.overrideValue = 0;
        this.lastValue = 0;
        this.lastDdr = 0;
        this.lastPin = 0;
        this.openCollector = 0;
        cpu.gpioPorts.add(this);
        cpu.gpioByPort[portConfig.PORT] = this;
        cpu.writeHooks[portConfig.DDR] = (value) => {
          const portValue = cpu.data[portConfig.PORT];
          cpu.data[portConfig.DDR] = value;
          this.writeGpio(portValue, value);
          this.updatePinRegister(value);
          return true;
        };
        cpu.writeHooks[portConfig.PORT] = (value) => {
          const ddrMask = cpu.data[portConfig.DDR];
          cpu.data[portConfig.PORT] = value;
          this.writeGpio(value, ddrMask);
          this.updatePinRegister(ddrMask);
          return true;
        };
        cpu.writeHooks[portConfig.PIN] = (value, oldValue, addr, mask) => {
          const oldPortValue = cpu.data[portConfig.PORT];
          const ddrMask = cpu.data[portConfig.DDR];
          const portValue = oldPortValue ^ value & mask;
          cpu.data[portConfig.PORT] = portValue;
          this.writeGpio(portValue, ddrMask);
          this.updatePinRegister(ddrMask);
          return true;
        };
        const { externalInterrupts } = portConfig;
        this.externalInts = externalInterrupts.map((externalConfig) => externalConfig ? {
          address: externalConfig.interrupt,
          flagRegister: externalConfig.EIFR,
          flagMask: 1 << externalConfig.index,
          enableRegister: externalConfig.EIMSK,
          enableMask: 1 << externalConfig.index
        } : null);
        const EICR = new Set(externalInterrupts.map((item) => item === null || item === void 0 ? void 0 : item.EICR));
        for (const EICRx of EICR) {
          this.attachInterruptHook(EICRx || 0);
        }
        const EIMSK = (_b = (_a = externalInterrupts.find((item) => item && item.EIMSK)) === null || _a === void 0 ? void 0 : _a.EIMSK) !== null && _b !== void 0 ? _b : 0;
        this.attachInterruptHook(EIMSK, "mask");
        const EIFR = (_d = (_c = externalInterrupts.find((item) => item && item.EIFR)) === null || _c === void 0 ? void 0 : _c.EIFR) !== null && _d !== void 0 ? _d : 0;
        this.attachInterruptHook(EIFR, "flag");
        const { pinChange } = portConfig;
        this.PCINT = pinChange ? {
          address: pinChange.pinChangeInterrupt,
          flagRegister: pinChange.PCIFR,
          flagMask: 1 << pinChange.PCIE,
          enableRegister: pinChange.PCICR,
          enableMask: 1 << pinChange.PCIE
        } : null;
        if (pinChange) {
          const { PCIFR, PCMSK } = pinChange;
          cpu.writeHooks[PCIFR] = (value) => {
            for (const gpio of this.cpu.gpioPorts) {
              const { PCINT } = gpio;
              if (PCINT) {
                cpu.clearInterruptByFlag(PCINT, value);
              }
            }
            return true;
          };
          cpu.writeHooks[PCMSK] = (value) => {
            cpu.data[PCMSK] = value;
            for (const gpio of this.cpu.gpioPorts) {
              const { PCINT } = gpio;
              if (PCINT) {
                cpu.updateInterruptEnable(PCINT, value);
              }
            }
            return true;
          };
        }
      }
      addListener(listener) {
        this.listeners.push(listener);
      }
      removeListener(listener) {
        this.listeners = this.listeners.filter((l) => l !== listener);
      }
      /**
       * Get the state of a given GPIO pin
       *
       * @param index Pin index to return from 0 to 7
       * @returns PinState.Low or PinState.High if the pin is set to output, PinState.Input if the pin is set
       *   to input, and PinState.InputPullUp if the pin is set to input and the internal pull-up resistor has
       *   been enabled.
       */
      pinState(index) {
        const ddr = this.cpu.data[this.portConfig.DDR];
        const port = this.cpu.data[this.portConfig.PORT];
        const bitMask = 1 << index;
        const openState = port & bitMask ? PinState2.InputPullUp : PinState2.Input;
        const highValue = this.openCollector & bitMask ? openState : PinState2.High;
        if (ddr & bitMask) {
          return this.lastValue & bitMask ? highValue : PinState2.Low;
        } else {
          return openState;
        }
      }
      /**
       * Sets the input value for the given pin. This is the value that
       * will be returned when reading from the PIN register.
       */
      setPin(index, value) {
        const bitMask = 1 << index;
        this.pinValue &= ~bitMask;
        if (value) {
          this.pinValue |= bitMask;
        }
        this.updatePinRegister(this.cpu.data[this.portConfig.DDR]);
      }
      /**
       * Internal method - do not call this directly!
       * Used by the timer compare output units to override GPIO pins.
       */
      timerOverridePin(pin2, mode) {
        const { cpu, portConfig } = this;
        const pinMask = 1 << pin2;
        if (mode === PinOverrideMode.None) {
          this.overrideMask |= pinMask;
          this.overrideValue &= ~pinMask;
        } else {
          this.overrideMask &= ~pinMask;
          switch (mode) {
            case PinOverrideMode.Enable:
              this.overrideValue &= ~pinMask;
              this.overrideValue |= cpu.data[portConfig.PORT] & pinMask;
              break;
            case PinOverrideMode.Set:
              this.overrideValue |= pinMask;
              break;
            case PinOverrideMode.Clear:
              this.overrideValue &= ~pinMask;
              break;
            case PinOverrideMode.Toggle:
              this.overrideValue ^= pinMask;
              break;
          }
        }
        const ddrMask = cpu.data[portConfig.DDR];
        this.writeGpio(cpu.data[portConfig.PORT], ddrMask);
        this.updatePinRegister(ddrMask);
      }
      updatePinRegister(ddr) {
        var _a, _b;
        const newPin = this.pinValue & ~ddr | this.lastValue & ddr;
        this.cpu.data[this.portConfig.PIN] = newPin;
        if (this.lastPin !== newPin) {
          for (let index = 0; index < 8; index++) {
            if ((newPin & 1 << index) !== (this.lastPin & 1 << index)) {
              const value = !!(newPin & 1 << index);
              this.toggleInterrupt(index, value);
              (_b = (_a = this.externalClockListeners)[index]) === null || _b === void 0 ? void 0 : _b.call(_a, value);
            }
          }
          this.lastPin = newPin;
        }
      }
      toggleInterrupt(pin2, risingEdge) {
        const { cpu, portConfig, externalInts, PCINT } = this;
        const { externalInterrupts, pinChange } = portConfig;
        const externalConfig = externalInterrupts[pin2];
        const external = externalInts[pin2];
        if (external && externalConfig) {
          const { EIMSK, index, EICR, iscOffset } = externalConfig;
          if (cpu.data[EIMSK] & 1 << index) {
            const configuration = cpu.data[EICR] >> iscOffset & 3;
            let generateInterrupt = false;
            external.constant = false;
            switch (configuration) {
              case InterruptMode.LowLevel:
                generateInterrupt = !risingEdge;
                external.constant = true;
                break;
              case InterruptMode.Change:
                generateInterrupt = true;
                break;
              case InterruptMode.FallingEdge:
                generateInterrupt = !risingEdge;
                break;
              case InterruptMode.RisingEdge:
                generateInterrupt = risingEdge;
                break;
            }
            if (generateInterrupt) {
              cpu.setInterruptFlag(external);
            } else if (external.constant) {
              cpu.clearInterrupt(external, true);
            }
          }
        }
        if (pinChange && PCINT && pinChange.mask & 1 << pin2) {
          const { PCMSK } = pinChange;
          if (cpu.data[PCMSK] & 1 << pin2 + pinChange.offset) {
            cpu.setInterruptFlag(PCINT);
          }
        }
      }
      attachInterruptHook(register, registerType = "other") {
        if (!register) {
          return;
        }
        const { cpu } = this;
        cpu.writeHooks[register] = (value) => {
          if (registerType !== "flag") {
            cpu.data[register] = value;
          }
          for (const gpio of cpu.gpioPorts) {
            for (const external of gpio.externalInts) {
              if (external && registerType === "mask") {
                cpu.updateInterruptEnable(external, value);
              }
              if (external && !external.constant && registerType === "flag") {
                cpu.clearInterruptByFlag(external, value);
              }
            }
            gpio.checkExternalInterrupts();
          }
          return true;
        };
      }
      checkExternalInterrupts() {
        const { cpu } = this;
        const { externalInterrupts } = this.portConfig;
        for (let pin2 = 0; pin2 < 8; pin2++) {
          const external = externalInterrupts[pin2];
          if (!external) {
            continue;
          }
          const pinValue = !!(this.lastPin & 1 << pin2);
          const { EIFR, EIMSK, index, EICR, iscOffset, interrupt } = external;
          if (!(cpu.data[EIMSK] & 1 << index) || pinValue) {
            continue;
          }
          const configuration = cpu.data[EICR] >> iscOffset & 3;
          if (configuration === InterruptMode.LowLevel) {
            cpu.queueInterrupt({
              address: interrupt,
              flagRegister: EIFR,
              flagMask: 1 << index,
              enableRegister: EIMSK,
              enableMask: 1 << index,
              constant: true
            });
          }
        }
      }
      writeGpio(value, ddr) {
        const newValue = (value & this.overrideMask | this.overrideValue) & ddr | value & ~ddr;
        const prevValue = this.lastValue;
        if (newValue !== prevValue || ddr !== this.lastDdr) {
          this.lastValue = newValue;
          this.lastDdr = ddr;
          for (const listener of this.listeners) {
            listener(newValue, prevValue);
          }
        }
      }
    };
    exports.AVRIOPort = AVRIOPort2;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/spi.js
var require_spi = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/spi.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRSPI = exports.spiConfig = void 0;
    var SPCR_SPIE = 128;
    var SPCR_SPE = 64;
    var SPCR_DORD = 32;
    var SPCR_MSTR = 16;
    var SPCR_CPOL = 8;
    var SPCR_CPHA = 4;
    var SPCR_SPR1 = 2;
    var SPCR_SPR0 = 1;
    var SPSR_SPR_MASK = SPCR_SPR1 | SPCR_SPR0;
    var SPSR_SPIF = 128;
    var SPSR_WCOL = 64;
    var SPSR_SPI2X = 1;
    exports.spiConfig = {
      spiInterrupt: 34,
      SPCR: 76,
      SPSR: 77,
      SPDR: 78
    };
    var bitsPerByte = 8;
    var AVRSPI = class {
      constructor(cpu, config, freqHz) {
        this.cpu = cpu;
        this.config = config;
        this.freqHz = freqHz;
        this.onTransfer = () => 0;
        this.onByte = (value) => {
          const valueIn = this.onTransfer(value);
          this.cpu.addClockEvent(() => this.completeTransfer(valueIn), this.transferCycles);
        };
        this.transmissionActive = false;
        this.SPI = {
          address: this.config.spiInterrupt,
          flagRegister: this.config.SPSR,
          flagMask: SPSR_SPIF,
          enableRegister: this.config.SPCR,
          enableMask: SPCR_SPIE
        };
        const { SPCR, SPSR, SPDR } = config;
        cpu.writeHooks[SPDR] = (value) => {
          if (!(cpu.data[SPCR] & SPCR_SPE)) {
            return;
          }
          if (this.transmissionActive) {
            cpu.data[SPSR] |= SPSR_WCOL;
            return true;
          }
          cpu.data[SPSR] &= ~SPSR_WCOL;
          this.cpu.clearInterrupt(this.SPI);
          this.transmissionActive = true;
          this.onByte(value);
          return true;
        };
        cpu.writeHooks[SPCR] = (value) => {
          this.cpu.updateInterruptEnable(this.SPI, value);
        };
        cpu.writeHooks[SPSR] = (value) => {
          this.cpu.data[SPSR] = value;
          this.cpu.clearInterruptByFlag(this.SPI, value);
        };
      }
      reset() {
        this.transmissionActive = false;
      }
      /**
       * Completes an SPI transaction. Call this method only from the `onByte` callback.
       *
       * @param receivedByte Byte read from the SPI MISO line.
       */
      completeTransfer(receivedByte) {
        const { SPDR } = this.config;
        this.cpu.data[SPDR] = receivedByte;
        this.cpu.setInterruptFlag(this.SPI);
        this.transmissionActive = false;
      }
      get isMaster() {
        return this.cpu.data[this.config.SPCR] & SPCR_MSTR ? true : false;
      }
      get dataOrder() {
        return this.cpu.data[this.config.SPCR] & SPCR_DORD ? "lsbFirst" : "msbFirst";
      }
      get spiMode() {
        const CPHA = this.cpu.data[this.config.SPCR] & SPCR_CPHA;
        const CPOL = this.cpu.data[this.config.SPCR] & SPCR_CPOL;
        return (CPHA ? 2 : 0) | (CPOL ? 1 : 0);
      }
      /**
       * The clock divider is only relevant for Master mode
       */
      get clockDivider() {
        const base = this.cpu.data[this.config.SPSR] & SPSR_SPI2X ? 2 : 4;
        switch (this.cpu.data[this.config.SPCR] & SPSR_SPR_MASK) {
          case 0:
            return base;
          case 1:
            return base * 4;
          case 2:
            return base * 16;
          case 3:
            return base * 32;
        }
        throw new Error("Invalid divider value!");
      }
      /** Number of cycles to complete a single byte SPI transaction */
      get transferCycles() {
        return this.clockDivider * bitsPerByte;
      }
      /**
       * The SPI freqeuncy is only relevant to Master mode.
       * In slave mode, the frequency can be as high as F(osc) / 4.
       */
      get spiFrequency() {
        return this.freqHz / this.clockDivider;
      }
    };
    exports.AVRSPI = AVRSPI;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/timer.js
var require_timer = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/timer.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRTimer = exports.timer2Config = exports.timer1Config = exports.timer0Config = void 0;
    var gpio_1 = require_gpio();
    var timer01Dividers = {
      0: 0,
      1: 1,
      2: 8,
      3: 64,
      4: 256,
      5: 1024,
      6: 0,
      // External clock - see ExternalClockMode
      7: 0
      // Ditto
    };
    var ExternalClockMode;
    (function(ExternalClockMode2) {
      ExternalClockMode2[ExternalClockMode2["FallingEdge"] = 6] = "FallingEdge";
      ExternalClockMode2[ExternalClockMode2["RisingEdge"] = 7] = "RisingEdge";
    })(ExternalClockMode || (ExternalClockMode = {}));
    var defaultTimerBits = {
      // TIFR bits
      TOV: 1,
      OCFA: 2,
      OCFB: 4,
      OCFC: 0,
      // Unused
      // TIMSK bits
      TOIE: 1,
      OCIEA: 2,
      OCIEB: 4,
      OCIEC: 0
      // Unused
    };
    exports.timer0Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 28, compBInterrupt: 30, compCInterrupt: 0, ovfInterrupt: 32, TIFR: 53, OCRA: 71, OCRB: 72, OCRC: 0, ICR: 0, TCNT: 70, TCCRA: 68, TCCRB: 69, TCCRC: 0, TIMSK: 110, dividers: timer01Dividers, compPortA: gpio_1.portDConfig.PORT, compPinA: 6, compPortB: gpio_1.portDConfig.PORT, compPinB: 5, compPortC: 0, compPinC: 0, externalClockPort: gpio_1.portDConfig.PORT, externalClockPin: 4 }, defaultTimerBits);
    exports.timer1Config = Object.assign({ bits: 16, captureInterrupt: 20, compAInterrupt: 22, compBInterrupt: 24, compCInterrupt: 0, ovfInterrupt: 26, TIFR: 54, OCRA: 136, OCRB: 138, OCRC: 0, ICR: 134, TCNT: 132, TCCRA: 128, TCCRB: 129, TCCRC: 130, TIMSK: 111, dividers: timer01Dividers, compPortA: gpio_1.portBConfig.PORT, compPinA: 1, compPortB: gpio_1.portBConfig.PORT, compPinB: 2, compPortC: 0, compPinC: 0, externalClockPort: gpio_1.portDConfig.PORT, externalClockPin: 5 }, defaultTimerBits);
    exports.timer2Config = Object.assign({ bits: 8, captureInterrupt: 0, compAInterrupt: 14, compBInterrupt: 16, compCInterrupt: 0, ovfInterrupt: 18, TIFR: 55, OCRA: 179, OCRB: 180, OCRC: 0, ICR: 0, TCNT: 178, TCCRA: 176, TCCRB: 177, TCCRC: 0, TIMSK: 112, dividers: {
      0: 0,
      1: 1,
      2: 8,
      3: 32,
      4: 64,
      5: 128,
      6: 256,
      7: 1024
    }, compPortA: gpio_1.portBConfig.PORT, compPinA: 3, compPortB: gpio_1.portDConfig.PORT, compPinB: 3, compPortC: 0, compPinC: 0, externalClockPort: 0, externalClockPin: 0 }, defaultTimerBits);
    var TimerMode;
    (function(TimerMode2) {
      TimerMode2[TimerMode2["Normal"] = 0] = "Normal";
      TimerMode2[TimerMode2["PWMPhaseCorrect"] = 1] = "PWMPhaseCorrect";
      TimerMode2[TimerMode2["CTC"] = 2] = "CTC";
      TimerMode2[TimerMode2["FastPWM"] = 3] = "FastPWM";
      TimerMode2[TimerMode2["PWMPhaseFrequencyCorrect"] = 4] = "PWMPhaseFrequencyCorrect";
      TimerMode2[TimerMode2["Reserved"] = 5] = "Reserved";
    })(TimerMode || (TimerMode = {}));
    var TOVUpdateMode;
    (function(TOVUpdateMode2) {
      TOVUpdateMode2[TOVUpdateMode2["Max"] = 0] = "Max";
      TOVUpdateMode2[TOVUpdateMode2["Top"] = 1] = "Top";
      TOVUpdateMode2[TOVUpdateMode2["Bottom"] = 2] = "Bottom";
    })(TOVUpdateMode || (TOVUpdateMode = {}));
    var OCRUpdateMode;
    (function(OCRUpdateMode2) {
      OCRUpdateMode2[OCRUpdateMode2["Immediate"] = 0] = "Immediate";
      OCRUpdateMode2[OCRUpdateMode2["Top"] = 1] = "Top";
      OCRUpdateMode2[OCRUpdateMode2["Bottom"] = 2] = "Bottom";
    })(OCRUpdateMode || (OCRUpdateMode = {}));
    var TopOCRA = 1;
    var TopICR = 2;
    var OCToggle = 1;
    var { Normal, PWMPhaseCorrect, CTC, FastPWM, Reserved, PWMPhaseFrequencyCorrect } = TimerMode;
    var wgmModes8Bit = [
      /*0*/
      [Normal, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*1*/
      [PWMPhaseCorrect, 255, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
      /*2*/
      [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*3*/
      [FastPWM, 255, OCRUpdateMode.Bottom, TOVUpdateMode.Max, 0],
      /*4*/
      [Reserved, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*5*/
      [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
      /*6*/
      [Reserved, 255, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*7*/
      [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle]
    ];
    var wgmModes16Bit = [
      /*0 */
      [Normal, 65535, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*1 */
      [PWMPhaseCorrect, 255, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
      /*2 */
      [PWMPhaseCorrect, 511, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
      /*3 */
      [PWMPhaseCorrect, 1023, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
      /*4 */
      [CTC, TopOCRA, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*5 */
      [FastPWM, 255, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
      /*6 */
      [FastPWM, 511, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
      /*7 */
      [FastPWM, 1023, OCRUpdateMode.Bottom, TOVUpdateMode.Top, 0],
      /*8 */
      [PWMPhaseFrequencyCorrect, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, 0],
      /*9 */
      [PWMPhaseFrequencyCorrect, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Bottom, OCToggle],
      /*10*/
      [PWMPhaseCorrect, TopICR, OCRUpdateMode.Top, TOVUpdateMode.Bottom, 0],
      /*11*/
      [PWMPhaseCorrect, TopOCRA, OCRUpdateMode.Top, TOVUpdateMode.Bottom, OCToggle],
      /*12*/
      [CTC, TopICR, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*13*/
      [Reserved, 65535, OCRUpdateMode.Immediate, TOVUpdateMode.Max, 0],
      /*14*/
      [FastPWM, TopICR, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle],
      /*15*/
      [FastPWM, TopOCRA, OCRUpdateMode.Bottom, TOVUpdateMode.Top, OCToggle]
    ];
    function compToOverride(comp) {
      switch (comp) {
        case 1:
          return gpio_1.PinOverrideMode.Toggle;
        case 2:
          return gpio_1.PinOverrideMode.Clear;
        case 3:
          return gpio_1.PinOverrideMode.Set;
        default:
          return gpio_1.PinOverrideMode.Enable;
      }
    }
    var FOCA = 1 << 7;
    var FOCB = 1 << 6;
    var FOCC = 1 << 5;
    var AVRTimer2 = class {
      constructor(cpu, config) {
        this.cpu = cpu;
        this.config = config;
        this.MAX = this.config.bits === 16 ? 65535 : 255;
        this.lastCycle = 0;
        this.ocrA = 0;
        this.nextOcrA = 0;
        this.ocrB = 0;
        this.nextOcrB = 0;
        this.hasOCRC = this.config.OCRC > 0;
        this.ocrC = 0;
        this.nextOcrC = 0;
        this.ocrUpdateMode = OCRUpdateMode.Immediate;
        this.tovUpdateMode = TOVUpdateMode.Max;
        this.icr = 0;
        this.tcnt = 0;
        this.tcntNext = 0;
        this.tcntUpdated = false;
        this.updateDivider = false;
        this.countingUp = true;
        this.divider = 0;
        this.externalClockRisingEdge = false;
        this.highByteTemp = 0;
        this.OVF = {
          address: this.config.ovfInterrupt,
          flagRegister: this.config.TIFR,
          flagMask: this.config.TOV,
          enableRegister: this.config.TIMSK,
          enableMask: this.config.TOIE
        };
        this.OCFA = {
          address: this.config.compAInterrupt,
          flagRegister: this.config.TIFR,
          flagMask: this.config.OCFA,
          enableRegister: this.config.TIMSK,
          enableMask: this.config.OCIEA
        };
        this.OCFB = {
          address: this.config.compBInterrupt,
          flagRegister: this.config.TIFR,
          flagMask: this.config.OCFB,
          enableRegister: this.config.TIMSK,
          enableMask: this.config.OCIEB
        };
        this.OCFC = {
          address: this.config.compCInterrupt,
          flagRegister: this.config.TIFR,
          flagMask: this.config.OCFC,
          enableRegister: this.config.TIMSK,
          enableMask: this.config.OCIEC
        };
        this.count = (reschedule = true, external = false) => {
          const { divider, lastCycle, cpu: cpu2 } = this;
          const { cycles } = cpu2;
          const delta = cycles - lastCycle;
          if (divider && delta >= divider || external) {
            const counterDelta = external ? 1 : Math.floor(delta / divider);
            this.lastCycle += counterDelta * divider;
            const val = this.tcnt;
            const { timerMode, TOP } = this;
            const phasePwm = timerMode === PWMPhaseCorrect || timerMode === PWMPhaseFrequencyCorrect;
            const newVal = phasePwm ? this.phasePwmCount(val, counterDelta) : (val + counterDelta) % (TOP + 1);
            const overflow = val + counterDelta > TOP;
            if (!this.tcntUpdated) {
              this.tcnt = newVal;
              if (!phasePwm) {
                this.timerUpdated(newVal, val);
              }
            }
            if (!phasePwm) {
              if (timerMode === FastPWM && overflow) {
                const { compA, compB } = this;
                if (compA) {
                  this.updateCompPin(compA, "A", true);
                }
                if (compB) {
                  this.updateCompPin(compB, "B", true);
                }
              }
              if (this.ocrUpdateMode == OCRUpdateMode.Bottom && overflow) {
                this.ocrA = this.nextOcrA;
                this.ocrB = this.nextOcrB;
                this.ocrC = this.nextOcrC;
              }
              if (overflow && (this.tovUpdateMode == TOVUpdateMode.Top || TOP === this.MAX)) {
                cpu2.setInterruptFlag(this.OVF);
              }
            }
          }
          if (this.tcntUpdated) {
            this.tcnt = this.tcntNext;
            this.tcntUpdated = false;
            if (this.tcnt === 0 && this.ocrUpdateMode === OCRUpdateMode.Bottom || this.tcnt === this.TOP && this.ocrUpdateMode === OCRUpdateMode.Top) {
              this.ocrA = this.nextOcrA;
              this.ocrB = this.nextOcrB;
              this.ocrC = this.nextOcrC;
            }
          }
          if (this.updateDivider) {
            const { CS } = this;
            const { externalClockPin } = this.config;
            const newDivider = this.config.dividers[CS];
            this.lastCycle = newDivider ? this.cpu.cycles : 0;
            this.updateDivider = false;
            this.divider = newDivider;
            if (this.config.externalClockPort && !this.externalClockPort) {
              this.externalClockPort = this.cpu.gpioByPort[this.config.externalClockPort];
            }
            if (this.externalClockPort) {
              this.externalClockPort.externalClockListeners[externalClockPin] = null;
            }
            if (newDivider) {
              cpu2.addClockEvent(this.count, this.lastCycle + newDivider - cpu2.cycles);
            } else if (this.externalClockPort && (CS === ExternalClockMode.FallingEdge || CS === ExternalClockMode.RisingEdge)) {
              this.externalClockPort.externalClockListeners[externalClockPin] = this.externalClockCallback;
              this.externalClockRisingEdge = CS === ExternalClockMode.RisingEdge;
            }
            return;
          }
          if (reschedule && divider) {
            cpu2.addClockEvent(this.count, this.lastCycle + divider - cpu2.cycles);
          }
        };
        this.externalClockCallback = (value) => {
          if (value === this.externalClockRisingEdge) {
            this.count(false, true);
          }
        };
        this.updateWGMConfig();
        this.cpu.readHooks[config.TCNT] = (addr) => {
          this.count(false);
          if (this.config.bits === 16) {
            this.cpu.data[addr + 1] = this.tcnt >> 8;
          }
          return this.cpu.data[addr] = this.tcnt & 255;
        };
        this.cpu.writeHooks[config.TCNT] = (value) => {
          this.tcntNext = this.highByteTemp << 8 | value;
          this.countingUp = true;
          this.tcntUpdated = true;
          this.cpu.updateClockEvent(this.count, 0);
          if (this.divider) {
            this.timerUpdated(this.tcntNext, this.tcntNext);
          }
        };
        this.cpu.writeHooks[config.OCRA] = (value) => {
          this.nextOcrA = this.highByteTemp << 8 | value;
          if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
            this.ocrA = this.nextOcrA;
          }
        };
        this.cpu.writeHooks[config.OCRB] = (value) => {
          this.nextOcrB = this.highByteTemp << 8 | value;
          if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
            this.ocrB = this.nextOcrB;
          }
        };
        if (this.hasOCRC) {
          this.cpu.writeHooks[config.OCRC] = (value) => {
            this.nextOcrC = this.highByteTemp << 8 | value;
            if (this.ocrUpdateMode === OCRUpdateMode.Immediate) {
              this.ocrC = this.nextOcrC;
            }
          };
        }
        if (this.config.bits === 16) {
          this.cpu.writeHooks[config.ICR] = (value) => {
            this.icr = this.highByteTemp << 8 | value;
          };
          const updateTempRegister = (value) => {
            this.highByteTemp = value;
          };
          const updateOCRHighRegister = (value, old, addr) => {
            this.highByteTemp = value & this.ocrMask >> 8;
            cpu.data[addr] = this.highByteTemp;
            return true;
          };
          this.cpu.writeHooks[config.TCNT + 1] = updateTempRegister;
          this.cpu.writeHooks[config.OCRA + 1] = updateOCRHighRegister;
          this.cpu.writeHooks[config.OCRB + 1] = updateOCRHighRegister;
          if (this.hasOCRC) {
            this.cpu.writeHooks[config.OCRC + 1] = updateOCRHighRegister;
          }
          this.cpu.writeHooks[config.ICR + 1] = updateTempRegister;
        }
        cpu.writeHooks[config.TCCRA] = (value) => {
          this.cpu.data[config.TCCRA] = value;
          this.updateWGMConfig();
          return true;
        };
        cpu.writeHooks[config.TCCRB] = (value) => {
          if (!config.TCCRC) {
            this.checkForceCompare(value);
            value &= ~(FOCA | FOCB);
          }
          this.cpu.data[config.TCCRB] = value;
          this.updateDivider = true;
          this.cpu.clearClockEvent(this.count);
          this.cpu.addClockEvent(this.count, 0);
          this.updateWGMConfig();
          return true;
        };
        if (config.TCCRC) {
          cpu.writeHooks[config.TCCRC] = (value) => {
            this.checkForceCompare(value);
          };
        }
        cpu.writeHooks[config.TIFR] = (value) => {
          this.cpu.data[config.TIFR] = value;
          this.cpu.clearInterruptByFlag(this.OVF, value);
          this.cpu.clearInterruptByFlag(this.OCFA, value);
          this.cpu.clearInterruptByFlag(this.OCFB, value);
          return true;
        };
        cpu.writeHooks[config.TIMSK] = (value) => {
          this.cpu.updateInterruptEnable(this.OVF, value);
          this.cpu.updateInterruptEnable(this.OCFA, value);
          this.cpu.updateInterruptEnable(this.OCFB, value);
        };
      }
      reset() {
        this.divider = 0;
        this.lastCycle = 0;
        this.ocrA = 0;
        this.nextOcrA = 0;
        this.ocrB = 0;
        this.nextOcrB = 0;
        this.ocrC = 0;
        this.nextOcrC = 0;
        this.icr = 0;
        this.tcnt = 0;
        this.tcntNext = 0;
        this.tcntUpdated = false;
        this.countingUp = false;
        this.updateDivider = true;
      }
      get TCCRA() {
        return this.cpu.data[this.config.TCCRA];
      }
      get TCCRB() {
        return this.cpu.data[this.config.TCCRB];
      }
      get TIMSK() {
        return this.cpu.data[this.config.TIMSK];
      }
      get CS() {
        return this.TCCRB & 7;
      }
      get WGM() {
        const mask = this.config.bits === 16 ? 24 : 8;
        return (this.TCCRB & mask) >> 1 | this.TCCRA & 3;
      }
      get TOP() {
        switch (this.topValue) {
          case TopOCRA:
            return this.ocrA;
          case TopICR:
            return this.icr;
          default:
            return this.topValue;
        }
      }
      get ocrMask() {
        switch (this.topValue) {
          case TopOCRA:
          case TopICR:
            return 65535;
          default:
            return this.topValue;
        }
      }
      /** Expose the raw value of TCNT, for use by the unit tests */
      get debugTCNT() {
        return this.tcnt;
      }
      updateWGMConfig() {
        const { config, WGM } = this;
        const wgmModes = config.bits === 16 ? wgmModes16Bit : wgmModes8Bit;
        const TCCRA = this.cpu.data[config.TCCRA];
        const [timerMode, topValue, ocrUpdateMode, tovUpdateMode, flags] = wgmModes[WGM];
        this.timerMode = timerMode;
        this.topValue = topValue;
        this.ocrUpdateMode = ocrUpdateMode;
        this.tovUpdateMode = tovUpdateMode;
        const pwmMode = timerMode === FastPWM || timerMode === PWMPhaseCorrect || timerMode === PWMPhaseFrequencyCorrect;
        const prevCompA = this.compA;
        this.compA = TCCRA >> 6 & 3;
        if (this.compA === 1 && pwmMode && !(flags & OCToggle)) {
          this.compA = 0;
        }
        if (!!prevCompA !== !!this.compA) {
          this.updateCompA(this.compA ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
        }
        const prevCompB = this.compB;
        this.compB = TCCRA >> 4 & 3;
        if (this.compB === 1 && pwmMode) {
          this.compB = 0;
        }
        if (!!prevCompB !== !!this.compB) {
          this.updateCompB(this.compB ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
        }
        if (this.hasOCRC) {
          const prevCompC = this.compC;
          this.compC = TCCRA >> 2 & 3;
          if (this.compC === 1 && pwmMode) {
            this.compC = 0;
          }
          if (!!prevCompC !== !!this.compC) {
            this.updateCompC(this.compC ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
          }
        }
      }
      phasePwmCount(value, delta) {
        const { ocrA, ocrB, ocrC, hasOCRC, TOP, MAX, tcntUpdated } = this;
        if (!value && !TOP) {
          delta = 0;
          if (this.ocrUpdateMode === OCRUpdateMode.Top) {
            this.ocrA = this.nextOcrA;
            this.ocrB = this.nextOcrB;
            this.ocrC = this.nextOcrC;
          }
        }
        while (delta > 0) {
          if (this.countingUp) {
            value++;
            if (value === TOP && !tcntUpdated) {
              this.countingUp = false;
              if (this.ocrUpdateMode === OCRUpdateMode.Top) {
                this.ocrA = this.nextOcrA;
                this.ocrB = this.nextOcrB;
                this.ocrC = this.nextOcrC;
              }
            }
          } else {
            value--;
            if (!value && !tcntUpdated) {
              this.countingUp = true;
              this.cpu.setInterruptFlag(this.OVF);
              if (this.ocrUpdateMode === OCRUpdateMode.Bottom) {
                this.ocrA = this.nextOcrA;
                this.ocrB = this.nextOcrB;
                this.ocrC = this.nextOcrC;
              }
            }
          }
          if (!tcntUpdated) {
            if (value === ocrA) {
              this.cpu.setInterruptFlag(this.OCFA);
              if (this.compA) {
                this.updateCompPin(this.compA, "A");
              }
            }
            if (value === ocrB) {
              this.cpu.setInterruptFlag(this.OCFB);
              if (this.compB) {
                this.updateCompPin(this.compB, "B");
              }
            }
            if (hasOCRC && value === ocrC) {
              this.cpu.setInterruptFlag(this.OCFC);
              if (this.compC) {
                this.updateCompPin(this.compC, "C");
              }
            }
          }
          delta--;
        }
        return value & MAX;
      }
      timerUpdated(value, prevValue) {
        const { ocrA, ocrB, ocrC, hasOCRC } = this;
        const overflow = prevValue > value;
        if ((prevValue < ocrA || overflow) && value >= ocrA || prevValue < ocrA && overflow) {
          this.cpu.setInterruptFlag(this.OCFA);
          if (this.compA) {
            this.updateCompPin(this.compA, "A");
          }
        }
        if ((prevValue < ocrB || overflow) && value >= ocrB || prevValue < ocrB && overflow) {
          this.cpu.setInterruptFlag(this.OCFB);
          if (this.compB) {
            this.updateCompPin(this.compB, "B");
          }
        }
        if (hasOCRC && ((prevValue < ocrC || overflow) && value >= ocrC || prevValue < ocrC && overflow)) {
          this.cpu.setInterruptFlag(this.OCFC);
          if (this.compC) {
            this.updateCompPin(this.compC, "C");
          }
        }
      }
      checkForceCompare(value) {
        if (this.timerMode == TimerMode.FastPWM || this.timerMode == TimerMode.PWMPhaseCorrect || this.timerMode == TimerMode.PWMPhaseFrequencyCorrect) {
          return;
        }
        if (value & FOCA) {
          this.updateCompPin(this.compA, "A");
        }
        if (value & FOCB) {
          this.updateCompPin(this.compB, "B");
        }
        if (this.config.compPortC && value & FOCC) {
          this.updateCompPin(this.compC, "C");
        }
      }
      updateCompPin(compValue, pinName, bottom = false) {
        let newValue = gpio_1.PinOverrideMode.None;
        const invertingMode = compValue === 3;
        const isSet = this.countingUp === invertingMode;
        switch (this.timerMode) {
          case Normal:
          case CTC:
            newValue = compToOverride(compValue);
            break;
          case FastPWM:
            if (compValue === 1) {
              newValue = bottom ? gpio_1.PinOverrideMode.None : gpio_1.PinOverrideMode.Toggle;
            } else {
              newValue = invertingMode !== bottom ? gpio_1.PinOverrideMode.Set : gpio_1.PinOverrideMode.Clear;
            }
            break;
          case PWMPhaseCorrect:
          case PWMPhaseFrequencyCorrect:
            if (compValue === 1) {
              newValue = gpio_1.PinOverrideMode.Toggle;
            } else {
              newValue = isSet ? gpio_1.PinOverrideMode.Set : gpio_1.PinOverrideMode.Clear;
            }
            break;
        }
        if (newValue !== gpio_1.PinOverrideMode.None) {
          if (pinName === "A") {
            this.updateCompA(newValue);
          } else if (pinName === "B") {
            this.updateCompB(newValue);
          } else {
            this.updateCompC(newValue);
          }
        }
      }
      updateCompA(value) {
        const { compPortA, compPinA } = this.config;
        const port = this.cpu.gpioByPort[compPortA];
        port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinA, value);
      }
      updateCompB(value) {
        const { compPortB, compPinB } = this.config;
        const port = this.cpu.gpioByPort[compPortB];
        port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinB, value);
      }
      updateCompC(value) {
        const { compPortC, compPinC } = this.config;
        const port = this.cpu.gpioByPort[compPortC];
        port === null || port === void 0 ? void 0 : port.timerOverridePin(compPinC, value);
      }
    };
    exports.AVRTimer = AVRTimer2;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/timer-attiny.js
var require_timer_attiny = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/timer-attiny.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.ATtinyTimer1 = exports.attinyTimer1Config = void 0;
    var gpio_1 = require_gpio();
    var CTC1 = 1 << 7;
    var PWM1A = 1 << 6;
    var CS_MASK = 15;
    var PWM1B_BIT = 1 << 6;
    var FOC1B = 1 << 3;
    var FOC1A = 1 << 2;
    var PSR1 = 1 << 1;
    exports.attinyTimer1Config = {
      TCCR1: 80,
      GTCCR: 76,
      TCNT1: 79,
      OCR1A: 78,
      OCR1B: 75,
      OCR1C: 77,
      TIFR: 88,
      TIMSK: 89,
      ovfInterrupt: 4,
      compAInterrupt: 3,
      compBInterrupt: 9,
      TOV1: 1 << 2,
      OCF1A: 1 << 6,
      OCF1B: 1 << 5,
      TOIE1: 1 << 2,
      OCIE1A: 1 << 6,
      OCIE1B: 1 << 5,
      compPortB: 56,
      compPinA: 1,
      // PB1
      compPinB: 4,
      // PB4
      dividers: {
        0: 0,
        1: 1,
        2: 2,
        3: 4,
        4: 8,
        5: 16,
        6: 32,
        7: 64,
        8: 128,
        9: 256,
        10: 512,
        11: 1024,
        12: 2048,
        13: 4096,
        14: 8192,
        15: 16384
      }
    };
    var ATtinyTimer1 = class {
      constructor(cpu, config) {
        this.cpu = cpu;
        this.config = config;
        this.lastCycle = 0;
        this.tcnt = 0;
        this.tcntNext = 0;
        this.tcntUpdated = false;
        this.ocrA = 0;
        this.ocrB = 0;
        this.ocrC = 0;
        this.divider = 0;
        this.updateDivider = false;
        this.countingUp = true;
        this.OVF = {
          address: this.config.ovfInterrupt,
          flagRegister: this.config.TIFR,
          flagMask: this.config.TOV1,
          enableRegister: this.config.TIMSK,
          enableMask: this.config.TOIE1
        };
        this.OCFA = {
          address: this.config.compAInterrupt,
          flagRegister: this.config.TIFR,
          flagMask: this.config.OCF1A,
          enableRegister: this.config.TIMSK,
          enableMask: this.config.OCIE1A
        };
        this.OCFB = {
          address: this.config.compBInterrupt,
          flagRegister: this.config.TIFR,
          flagMask: this.config.OCF1B,
          enableRegister: this.config.TIMSK,
          enableMask: this.config.OCIE1B
        };
        this.count = (reschedule = true) => {
          var _a;
          const { divider, lastCycle, cpu: cpu2 } = this;
          const { cycles } = cpu2;
          const delta = cycles - lastCycle;
          if (divider && delta >= divider) {
            const counterDelta = Math.floor(delta / divider);
            this.lastCycle += counterDelta * divider;
            const val = this.tcnt;
            const top = this.TOP;
            const phasePwm = (this.pwmA || this.pwmB) && !this.ctcMode;
            const newVal = phasePwm ? this.phasePwmCount(val, counterDelta) : (val + counterDelta) % (top + 1);
            const overflow = val + counterDelta > top;
            if (!this.tcntUpdated) {
              this.tcnt = newVal;
              if (!phasePwm) {
                this.timerUpdated(newVal, val);
              }
            }
            if (!phasePwm && overflow) {
              cpu2.setInterruptFlag(this.OVF);
            }
          }
          if (this.tcntUpdated) {
            this.tcnt = this.tcntNext;
            this.tcntUpdated = false;
          }
          if (this.updateDivider) {
            const cs = this.CS;
            const newDivider = (_a = this.config.dividers[cs]) !== null && _a !== void 0 ? _a : 0;
            this.lastCycle = newDivider ? this.cpu.cycles : 0;
            this.updateDivider = false;
            this.divider = newDivider;
            if (newDivider) {
              cpu2.addClockEvent(this.count, this.lastCycle + newDivider - cpu2.cycles);
            }
            return;
          }
          if (reschedule && divider) {
            cpu2.addClockEvent(this.count, this.lastCycle + divider - cpu2.cycles);
          }
        };
        const { TCCR1, GTCCR, TCNT1, OCR1A, OCR1B, OCR1C, TIFR, TIMSK } = config;
        cpu.readHooks[TCNT1] = () => {
          this.count(false);
          return cpu.data[TCNT1] = this.tcnt & 255;
        };
        cpu.writeHooks[TCNT1] = (value) => {
          this.tcntNext = value;
          this.countingUp = true;
          this.tcntUpdated = true;
          cpu.updateClockEvent(this.count, 0);
          if (this.divider) {
            this.timerUpdated(this.tcntNext, this.tcntNext);
          }
        };
        cpu.writeHooks[OCR1A] = (value) => {
          this.ocrA = value;
        };
        cpu.writeHooks[OCR1B] = (value) => {
          this.ocrB = value;
        };
        cpu.writeHooks[OCR1C] = (value) => {
          this.ocrC = value;
        };
        cpu.writeHooks[TCCR1] = (value) => {
          cpu.data[TCCR1] = value;
          this.updateDivider = true;
          cpu.clearClockEvent(this.count);
          cpu.addClockEvent(this.count, 0);
          this.updateCompConfig();
          return true;
        };
        const prevGtccrHook = cpu.writeHooks[GTCCR];
        cpu.writeHooks[GTCCR] = (value, oldValue, addr, mask) => {
          if (value & FOC1A) {
            this.forceCompare("A");
          }
          if (value & FOC1B) {
            this.forceCompare("B");
          }
          if (value & PSR1) {
            this.lastCycle = this.cpu.cycles;
          }
          value &= ~(FOC1A | FOC1B | PSR1);
          if (prevGtccrHook) {
            prevGtccrHook(value, oldValue, addr, mask);
          } else {
            cpu.data[GTCCR] = value;
          }
          this.updateCompConfig();
          return true;
        };
        const prevTifrHook = cpu.writeHooks[TIFR];
        cpu.writeHooks[TIFR] = (value, oldValue, addr, mask) => {
          if (prevTifrHook) {
            prevTifrHook(value, oldValue, addr, mask);
          } else {
            cpu.data[TIFR] = value;
          }
          cpu.clearInterruptByFlag(this.OVF, value);
          cpu.clearInterruptByFlag(this.OCFA, value);
          cpu.clearInterruptByFlag(this.OCFB, value);
          return true;
        };
        const prevTimskHook = cpu.writeHooks[TIMSK];
        cpu.writeHooks[TIMSK] = (value, oldValue, addr, mask) => {
          if (prevTimskHook) {
            prevTimskHook(value, oldValue, addr, mask);
          }
          cpu.updateInterruptEnable(this.OVF, value);
          cpu.updateInterruptEnable(this.OCFA, value);
          cpu.updateInterruptEnable(this.OCFB, value);
        };
      }
      get tccr1() {
        return this.cpu.data[this.config.TCCR1];
      }
      get gtccr() {
        return this.cpu.data[this.config.GTCCR];
      }
      get CS() {
        return this.tccr1 & CS_MASK;
      }
      get ctcMode() {
        return !!(this.tccr1 & CTC1);
      }
      get pwmA() {
        return !!(this.tccr1 & PWM1A);
      }
      get pwmB() {
        return !!(this.gtccr & PWM1B_BIT);
      }
      get comA() {
        return this.tccr1 >> 4 & 3;
      }
      get comB() {
        return this.gtccr >> 4 & 3;
      }
      /** TOP = OCR1C in CTC/PWM modes, 0xFF in Normal mode */
      get TOP() {
        if (this.ctcMode || this.pwmA || this.pwmB) {
          return this.ocrC;
        }
        return 255;
      }
      phasePwmCount(value, delta) {
        const top = this.TOP;
        while (delta > 0) {
          if (this.countingUp) {
            value++;
            if (value >= top) {
              value = top;
              this.countingUp = false;
            }
          } else {
            value--;
            if (value <= 0) {
              value = 0;
              this.countingUp = true;
              this.cpu.setInterruptFlag(this.OVF);
            }
          }
          if (!this.tcntUpdated) {
            if (value === this.ocrA) {
              this.cpu.setInterruptFlag(this.OCFA);
              this.updateCompPinPwm("A");
            }
            if (value === this.ocrB) {
              this.cpu.setInterruptFlag(this.OCFB);
              this.updateCompPinPwm("B");
            }
          }
          delta--;
        }
        return value & 255;
      }
      timerUpdated(value, prevValue) {
        const { ocrA, ocrB } = this;
        const overflow = prevValue > value;
        if ((prevValue < ocrA || overflow) && value >= ocrA || prevValue < ocrA && overflow) {
          this.cpu.setInterruptFlag(this.OCFA);
          if (this.comA && !this.pwmA) {
            this.updateCompPinNonPwm("A");
          }
        }
        if ((prevValue < ocrB || overflow) && value >= ocrB || prevValue < ocrB && overflow) {
          this.cpu.setInterruptFlag(this.OCFB);
          if (this.comB && !this.pwmB) {
            this.updateCompPinNonPwm("B");
          }
        }
      }
      forceCompare(channel) {
        if (channel === "A" && !this.pwmA && this.comA) {
          this.updateCompPinNonPwm("A");
        } else if (channel === "B" && !this.pwmB && this.comB) {
          this.updateCompPinNonPwm("B");
        }
      }
      updateCompPinNonPwm(channel) {
        var _a;
        const com = channel === "A" ? this.comA : this.comB;
        const pin2 = channel === "A" ? this.config.compPinA : this.config.compPinB;
        let mode;
        switch (com) {
          case 1:
            mode = gpio_1.PinOverrideMode.Toggle;
            break;
          case 2:
            mode = gpio_1.PinOverrideMode.Clear;
            break;
          case 3:
            mode = gpio_1.PinOverrideMode.Set;
            break;
          default:
            return;
        }
        (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 ? void 0 : _a.timerOverridePin(pin2, mode);
      }
      updateCompPinPwm(channel) {
        var _a;
        const com = channel === "A" ? this.comA : this.comB;
        const pin2 = channel === "A" ? this.config.compPinA : this.config.compPinB;
        const invertingMode = com === 3;
        const isSet = this.countingUp === invertingMode;
        let mode;
        switch (com) {
          case 1:
            mode = gpio_1.PinOverrideMode.Toggle;
            break;
          case 2:
          case 3:
            mode = isSet ? gpio_1.PinOverrideMode.Set : gpio_1.PinOverrideMode.Clear;
            break;
          default:
            return;
        }
        (_a = this.cpu.gpioByPort[this.config.compPortB]) === null || _a === void 0 ? void 0 : _a.timerOverridePin(pin2, mode);
      }
      updateCompConfig() {
        const port = this.cpu.gpioByPort[this.config.compPortB];
        if (!port)
          return;
        port.timerOverridePin(this.config.compPinA, this.comA ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
        port.timerOverridePin(this.config.compPinB, this.comB ? gpio_1.PinOverrideMode.Enable : gpio_1.PinOverrideMode.None);
      }
    };
    exports.ATtinyTimer1 = ATtinyTimer1;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/twi.js
var require_twi = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/twi.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRTWI = exports.NoopTWIEventHandler = exports.twiConfig = void 0;
    var TWCR_TWINT = 128;
    var TWCR_TWEA = 64;
    var TWCR_TWSTA = 32;
    var TWCR_TWSTO = 16;
    var TWCR_TWEN = 4;
    var TWCR_TWIE = 1;
    var TWSR_TWS_MASK = 248;
    var TWSR_TWPS1 = 2;
    var TWSR_TWPS0 = 1;
    var TWSR_TWPS_MASK = TWSR_TWPS1 | TWSR_TWPS0;
    var STATUS_TWI_IDLE = 248;
    var STATUS_START = 8;
    var STATUS_REPEATED_START = 16;
    var STATUS_SLAW_ACK = 24;
    var STATUS_SLAW_NACK = 32;
    var STATUS_DATA_SENT_ACK = 40;
    var STATUS_DATA_SENT_NACK = 48;
    var STATUS_SLAR_ACK = 64;
    var STATUS_SLAR_NACK = 72;
    var STATUS_DATA_RECEIVED_ACK = 80;
    var STATUS_DATA_RECEIVED_NACK = 88;
    exports.twiConfig = {
      twiInterrupt: 48,
      TWBR: 184,
      TWSR: 185,
      TWAR: 186,
      TWDR: 187,
      TWCR: 188,
      TWAMR: 189
    };
    var NoopTWIEventHandler = class {
      constructor(twi) {
        this.twi = twi;
      }
      start() {
        this.twi.completeStart();
      }
      stop() {
        this.twi.completeStop();
      }
      connectToSlave() {
        this.twi.completeConnect(false);
      }
      writeByte() {
        this.twi.completeWrite(false);
      }
      readByte() {
        this.twi.completeRead(255);
      }
    };
    exports.NoopTWIEventHandler = NoopTWIEventHandler;
    var AVRTWI2 = class {
      constructor(cpu, config, freqHz) {
        this.cpu = cpu;
        this.config = config;
        this.freqHz = freqHz;
        this.eventHandler = new NoopTWIEventHandler(this);
        this.busy = false;
        this.TWI = {
          address: this.config.twiInterrupt,
          flagRegister: this.config.TWCR,
          flagMask: TWCR_TWINT,
          enableRegister: this.config.TWCR,
          enableMask: TWCR_TWIE
        };
        this.updateStatus(STATUS_TWI_IDLE);
        this.cpu.writeHooks[config.TWCR] = (value) => {
          this.cpu.data[config.TWCR] = value;
          const clearInt = value & TWCR_TWINT;
          this.cpu.clearInterruptByFlag(this.TWI, value);
          this.cpu.updateInterruptEnable(this.TWI, value);
          const { status } = this;
          if (clearInt && value & TWCR_TWEN && !this.busy) {
            const twdrValue = this.cpu.data[this.config.TWDR];
            this.cpu.addClockEvent(() => {
              if (value & TWCR_TWSTA) {
                this.busy = true;
                this.eventHandler.start(status !== STATUS_TWI_IDLE);
              } else if (value & TWCR_TWSTO) {
                this.busy = true;
                this.eventHandler.stop();
              } else if (status === STATUS_START || status === STATUS_REPEATED_START) {
                this.busy = true;
                this.eventHandler.connectToSlave(twdrValue >> 1, twdrValue & 1 ? false : true);
              } else if (status === STATUS_SLAW_ACK || status === STATUS_DATA_SENT_ACK) {
                this.busy = true;
                this.eventHandler.writeByte(twdrValue);
              } else if (status === STATUS_SLAR_ACK || status === STATUS_DATA_RECEIVED_ACK) {
                this.busy = true;
                const ack = !!(value & TWCR_TWEA);
                this.eventHandler.readByte(ack);
              }
            }, 0);
            return true;
          }
        };
      }
      get prescaler() {
        switch (this.cpu.data[this.config.TWSR] & TWSR_TWPS_MASK) {
          case 0:
            return 1;
          case 1:
            return 4;
          case 2:
            return 16;
          case 3:
            return 64;
        }
        throw new Error("Invalid prescaler value!");
      }
      get sclFrequency() {
        return this.freqHz / (16 + 2 * this.cpu.data[this.config.TWBR] * this.prescaler);
      }
      completeStart() {
        this.busy = false;
        this.updateStatus(this.status === STATUS_TWI_IDLE ? STATUS_START : STATUS_REPEATED_START);
      }
      completeStop() {
        this.busy = false;
        this.cpu.data[this.config.TWCR] &= ~TWCR_TWSTO;
        this.updateStatus(STATUS_TWI_IDLE);
      }
      completeConnect(ack) {
        this.busy = false;
        if (this.cpu.data[this.config.TWDR] & 1) {
          this.updateStatus(ack ? STATUS_SLAR_ACK : STATUS_SLAR_NACK);
        } else {
          this.updateStatus(ack ? STATUS_SLAW_ACK : STATUS_SLAW_NACK);
        }
      }
      completeWrite(ack) {
        this.busy = false;
        this.updateStatus(ack ? STATUS_DATA_SENT_ACK : STATUS_DATA_SENT_NACK);
      }
      completeRead(value) {
        this.busy = false;
        const ack = !!(this.cpu.data[this.config.TWCR] & TWCR_TWEA);
        this.cpu.data[this.config.TWDR] = value;
        this.updateStatus(ack ? STATUS_DATA_RECEIVED_ACK : STATUS_DATA_RECEIVED_NACK);
      }
      get status() {
        return this.cpu.data[this.config.TWSR] & TWSR_TWS_MASK;
      }
      updateStatus(value) {
        const { TWSR } = this.config;
        this.cpu.data[TWSR] = this.cpu.data[TWSR] & ~TWSR_TWS_MASK | value;
        this.cpu.setInterruptFlag(this.TWI);
      }
    };
    exports.AVRTWI = AVRTWI2;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/usart.js
var require_usart = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/usart.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRUSART = exports.usart0Config = void 0;
    exports.usart0Config = {
      rxCompleteInterrupt: 36,
      dataRegisterEmptyInterrupt: 38,
      txCompleteInterrupt: 40,
      UCSRA: 192,
      UCSRB: 193,
      UCSRC: 194,
      UBRRL: 196,
      UBRRH: 197,
      UDR: 198
    };
    var UCSRA_RXC = 128;
    var UCSRA_TXC = 64;
    var UCSRA_UDRE = 32;
    var UCSRA_U2X = 2;
    var UCSRA_MPCM = 1;
    var UCSRA_CFG_MASK = UCSRA_U2X;
    var UCSRB_RXCIE = 128;
    var UCSRB_TXCIE = 64;
    var UCSRB_UDRIE = 32;
    var UCSRB_RXEN = 16;
    var UCSRB_TXEN = 8;
    var UCSRB_UCSZ2 = 4;
    var UCSRB_CFG_MASK = UCSRB_UCSZ2 | UCSRB_RXEN | UCSRB_TXEN;
    var UCSRC_UPM1 = 32;
    var UCSRC_UPM0 = 16;
    var UCSRC_USBS = 8;
    var UCSRC_UCSZ1 = 4;
    var UCSRC_UCSZ0 = 2;
    var rxMasks = {
      5: 31,
      6: 63,
      7: 127,
      8: 255,
      9: 255
    };
    var AVRUSART2 = class {
      constructor(cpu, config, freqHz) {
        this.cpu = cpu;
        this.config = config;
        this.freqHz = freqHz;
        this.onByteTransmit = null;
        this.onLineTransmit = null;
        this.onRxComplete = null;
        this.onConfigurationChange = null;
        this.rxBusyValue = false;
        this.rxByte = 0;
        this.lineBuffer = "";
        this.RXC = {
          address: this.config.rxCompleteInterrupt,
          flagRegister: this.config.UCSRA,
          flagMask: UCSRA_RXC,
          enableRegister: this.config.UCSRB,
          enableMask: UCSRB_RXCIE,
          constant: true
        };
        this.UDRE = {
          address: this.config.dataRegisterEmptyInterrupt,
          flagRegister: this.config.UCSRA,
          flagMask: UCSRA_UDRE,
          enableRegister: this.config.UCSRB,
          enableMask: UCSRB_UDRIE
        };
        this.TXC = {
          address: this.config.txCompleteInterrupt,
          flagRegister: this.config.UCSRA,
          flagMask: UCSRA_TXC,
          enableRegister: this.config.UCSRB,
          enableMask: UCSRB_TXCIE
        };
        this.reset();
        this.cpu.writeHooks[config.UCSRA] = (value, oldValue) => {
          var _a;
          cpu.data[config.UCSRA] = value & (UCSRA_MPCM | UCSRA_U2X);
          cpu.clearInterruptByFlag(this.TXC, value);
          if ((value & UCSRA_CFG_MASK) !== (oldValue & UCSRA_CFG_MASK)) {
            (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
          }
          return true;
        };
        this.cpu.writeHooks[config.UCSRB] = (value, oldValue) => {
          var _a;
          cpu.updateInterruptEnable(this.RXC, value);
          cpu.updateInterruptEnable(this.UDRE, value);
          cpu.updateInterruptEnable(this.TXC, value);
          if (value & UCSRB_RXEN && oldValue & UCSRB_RXEN) {
            cpu.clearInterrupt(this.RXC);
          }
          if (value & UCSRB_TXEN && !(oldValue & UCSRB_TXEN)) {
            cpu.setInterruptFlag(this.UDRE);
          }
          cpu.data[config.UCSRB] = value;
          if ((value & UCSRB_CFG_MASK) !== (oldValue & UCSRB_CFG_MASK)) {
            (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
          }
          return true;
        };
        this.cpu.writeHooks[config.UCSRC] = (value) => {
          var _a;
          cpu.data[config.UCSRC] = value;
          (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
          return true;
        };
        this.cpu.readHooks[config.UDR] = () => {
          var _a;
          const mask = (_a = rxMasks[this.bitsPerChar]) !== null && _a !== void 0 ? _a : 255;
          const result = this.rxByte & mask;
          this.rxByte = 0;
          this.cpu.clearInterrupt(this.RXC);
          return result;
        };
        this.cpu.writeHooks[config.UDR] = (value) => {
          if (this.onByteTransmit) {
            this.onByteTransmit(value);
          }
          if (this.onLineTransmit) {
            const ch = String.fromCharCode(value);
            if (ch === "\n") {
              this.onLineTransmit(this.lineBuffer);
              this.lineBuffer = "";
            } else {
              this.lineBuffer += ch;
            }
          }
          this.cpu.addClockEvent(() => {
            cpu.setInterruptFlag(this.UDRE);
            cpu.setInterruptFlag(this.TXC);
          }, this.cyclesPerChar);
          this.cpu.clearInterrupt(this.TXC);
          this.cpu.clearInterrupt(this.UDRE);
        };
        this.cpu.writeHooks[config.UBRRH] = (value) => {
          var _a;
          this.cpu.data[config.UBRRH] = value;
          (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
          return true;
        };
        this.cpu.writeHooks[config.UBRRL] = (value) => {
          var _a;
          this.cpu.data[config.UBRRL] = value;
          (_a = this.onConfigurationChange) === null || _a === void 0 ? void 0 : _a.call(this);
          return true;
        };
      }
      reset() {
        this.cpu.data[this.config.UCSRA] = UCSRA_UDRE;
        this.cpu.data[this.config.UCSRB] = 0;
        this.cpu.data[this.config.UCSRC] = UCSRC_UCSZ1 | UCSRC_UCSZ0;
        this.rxBusyValue = false;
        this.rxByte = 0;
        this.lineBuffer = "";
      }
      get rxBusy() {
        return this.rxBusyValue;
      }
      writeByte(value, immediate = false) {
        var _a;
        const { cpu } = this;
        if (this.rxBusyValue || !this.rxEnable) {
          return false;
        }
        if (immediate) {
          this.rxByte = value;
          cpu.setInterruptFlag(this.RXC);
          (_a = this.onRxComplete) === null || _a === void 0 ? void 0 : _a.call(this);
        } else {
          this.rxBusyValue = true;
          cpu.addClockEvent(() => {
            this.rxBusyValue = false;
            this.writeByte(value, true);
          }, this.cyclesPerChar);
          return true;
        }
      }
      get cyclesPerChar() {
        const symbolsPerChar = 1 + this.bitsPerChar + this.stopBits + (this.parityEnabled ? 1 : 0);
        return (this.UBRR + 1) * this.multiplier * symbolsPerChar;
      }
      get UBRR() {
        const { UBRRH, UBRRL } = this.config;
        return this.cpu.data[UBRRH] << 8 | this.cpu.data[UBRRL];
      }
      get multiplier() {
        return this.cpu.data[this.config.UCSRA] & UCSRA_U2X ? 8 : 16;
      }
      get rxEnable() {
        return !!(this.cpu.data[this.config.UCSRB] & UCSRB_RXEN);
      }
      get txEnable() {
        return !!(this.cpu.data[this.config.UCSRB] & UCSRB_TXEN);
      }
      get baudRate() {
        return Math.floor(this.freqHz / (this.multiplier * (1 + this.UBRR)));
      }
      get bitsPerChar() {
        const ucsz = (this.cpu.data[this.config.UCSRC] & (UCSRC_UCSZ1 | UCSRC_UCSZ0)) >> 1 | this.cpu.data[this.config.UCSRB] & UCSRB_UCSZ2;
        switch (ucsz) {
          case 0:
            return 5;
          case 1:
            return 6;
          case 2:
            return 7;
          case 3:
            return 8;
          default:
          // 4..6 are reserved
          case 7:
            return 9;
        }
      }
      get stopBits() {
        return this.cpu.data[this.config.UCSRC] & UCSRC_USBS ? 2 : 1;
      }
      get parityEnabled() {
        return this.cpu.data[this.config.UCSRC] & UCSRC_UPM1 ? true : false;
      }
      get parityOdd() {
        return this.cpu.data[this.config.UCSRC] & UCSRC_UPM0 ? true : false;
      }
    };
    exports.AVRUSART = AVRUSART2;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/usi.js
var require_usi = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/usi.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRUSI = void 0;
    var USICR = 45;
    var USISR = 46;
    var USIDR = 47;
    var USIBR = 48;
    var USICNT_MASK = 15;
    var USIDC = 1 << 4;
    var USIPF = 1 << 5;
    var USIOIF = 1 << 6;
    var USISIF = 1 << 7;
    var USITC = 1 << 0;
    var USICLK = 1 << 1;
    var USICS0 = 1 << 2;
    var USICS1 = 1 << 3;
    var USIWM0 = 1 << 4;
    var USIWM1 = 1 << 5;
    var USIOIE = 1 << 6;
    var USISIE = 1 << 7;
    var AVRUSI = class {
      constructor(cpu, port, portPin, dataPin, clockPin) {
        this.START = {
          address: 13,
          flagRegister: USISR,
          flagMask: USISIF,
          enableRegister: USICR,
          enableMask: USISIE
        };
        this.OVF = {
          address: 14,
          flagRegister: USISR,
          flagMask: USIOIF,
          enableRegister: USICR,
          enableMask: USIOIE
        };
        const PIN = portPin;
        const PORT = PIN + 2;
        port.addListener((value) => {
          const twoWire = (cpu.data[USICR] & USIWM1) === USIWM1;
          if (twoWire) {
            if (value & 1 << clockPin && !(value & 1 << dataPin)) {
              cpu.setInterruptFlag(this.START);
            }
            if (value & 1 << clockPin && value & 1 << dataPin) {
              cpu.data[USISR] |= USIPF;
            }
          }
        });
        const updateOutput = () => {
          const oldValue = cpu.data[PORT];
          const newValue = cpu.data[USIDR] & 128 ? oldValue | 1 << dataPin : oldValue & ~(1 << dataPin);
          cpu.writeHooks[PORT](newValue, oldValue, PORT, 255);
          if (newValue & 128 && !(cpu.data[PIN] & 128)) {
            cpu.data[USISR] |= USIDC;
          } else {
            cpu.data[USISR] &= ~USIDC;
          }
        };
        const count = () => {
          const counter = cpu.data[USISR] + 1 & USICNT_MASK;
          cpu.data[USISR] = cpu.data[USISR] & ~USICNT_MASK | counter;
          if (!counter) {
            cpu.data[USIBR] = cpu.data[USIDR];
            cpu.setInterruptFlag(this.OVF);
          }
        };
        const shift = (inputValue) => {
          cpu.data[USIDR] = cpu.data[USIDR] << 1 | inputValue;
          updateOutput();
        };
        cpu.writeHooks[USIDR] = (value) => {
          cpu.data[USIDR] = value;
          updateOutput();
          return true;
        };
        cpu.writeHooks[USISR] = (value) => {
          const writeClearMask = USISIF | USIOIF | USIPF;
          cpu.data[USISR] = cpu.data[USISR] & writeClearMask & ~value | value & 15;
          cpu.clearInterruptByFlag(this.START, value);
          cpu.clearInterruptByFlag(this.OVF, value);
          return true;
        };
        cpu.writeHooks[USICR] = (value) => {
          cpu.data[USICR] = value & ~(USICLK | USITC);
          cpu.updateInterruptEnable(this.START, value);
          cpu.updateInterruptEnable(this.OVF, value);
          const clockSrc = value & (USICS1 | USICS0) >> 2;
          const mode = value & (USIWM1 | USIWM0) >> 4;
          const usiClk = value & USICLK;
          port.openCollector = mode >= 2 ? 1 << dataPin : 0;
          const inputValue = cpu.data[PIN] & 1 << dataPin ? 1 : 0;
          if (usiClk && !clockSrc) {
            shift(inputValue);
            count();
          }
          if (value & USITC) {
            cpu.writeHooks[PIN](1 << clockPin, cpu.data[PIN], PIN, 255);
            const newValue = cpu.data[PIN] & 1 << clockPin;
            if (usiClk && (clockSrc === 2 || clockSrc === 3)) {
              if (clockSrc === 2 && newValue) {
                shift(inputValue);
              }
              if (clockSrc === 3 && !newValue) {
                shift(inputValue);
              }
              count();
            }
            return true;
          }
        };
      }
    };
    exports.AVRUSI = AVRUSI;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/watchdog.js
var require_watchdog = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/peripherals/watchdog.js"(exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.AVRWatchdog = exports.watchdogConfig = void 0;
    var MCUSR_WDRF = 8;
    var WDTCSR_WDIF = 128;
    var WDTCSR_WDIE = 64;
    var WDTCSR_WDP3 = 32;
    var WDTCSR_WDCE = 16;
    var WDTCSR_WDE = 8;
    var WDTCSR_WDP2 = 4;
    var WDTCSR_WDP1 = 2;
    var WDTCSR_WDP0 = 1;
    var WDTCSR_WDP210 = WDTCSR_WDP2 | WDTCSR_WDP1 | WDTCSR_WDP0;
    var WDTCSR_PROTECT_MASK = WDTCSR_WDE | WDTCSR_WDP3 | WDTCSR_WDP210;
    exports.watchdogConfig = {
      watchdogInterrupt: 12,
      MCUSR: 84,
      WDTCSR: 96
    };
    var AVRWatchdog = class {
      constructor(cpu, config, clock) {
        this.cpu = cpu;
        this.config = config;
        this.clock = clock;
        this.clockFrequency = 128e3;
        this.changeEnabledCycles = 0;
        this.watchdogTimeout = 0;
        this.enabledValue = false;
        this.scheduled = false;
        this.Watchdog = {
          address: this.config.watchdogInterrupt,
          flagRegister: this.config.WDTCSR,
          flagMask: WDTCSR_WDIF,
          enableRegister: this.config.WDTCSR,
          enableMask: WDTCSR_WDIE
        };
        this.checkWatchdog = () => {
          if (this.enabled && this.cpu.cycles >= this.watchdogTimeout) {
            const wdtcsr = this.cpu.data[this.config.WDTCSR];
            if (wdtcsr & WDTCSR_WDIE) {
              this.cpu.setInterruptFlag(this.Watchdog);
            }
            if (wdtcsr & WDTCSR_WDE) {
              if (wdtcsr & WDTCSR_WDIE) {
                this.cpu.data[this.config.WDTCSR] &= ~WDTCSR_WDIE;
              } else {
                this.cpu.reset();
                this.scheduled = false;
                this.cpu.data[this.config.MCUSR] |= MCUSR_WDRF;
                return;
              }
            }
            this.resetWatchdog();
          }
          if (this.enabled) {
            this.scheduled = true;
            this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles);
          } else {
            this.scheduled = false;
          }
        };
        const { WDTCSR } = config;
        this.cpu.onWatchdogReset = () => {
          this.resetWatchdog();
        };
        cpu.writeHooks[WDTCSR] = (value, oldValue) => {
          if (value & WDTCSR_WDCE && value & WDTCSR_WDE) {
            this.changeEnabledCycles = this.cpu.cycles + 4;
            value = value & ~WDTCSR_PROTECT_MASK;
          } else {
            if (this.cpu.cycles >= this.changeEnabledCycles) {
              value = value & ~WDTCSR_PROTECT_MASK | oldValue & WDTCSR_PROTECT_MASK;
            }
            this.enabledValue = !!(value & WDTCSR_WDE || value & WDTCSR_WDIE);
            this.cpu.data[WDTCSR] = value;
          }
          if (this.enabled) {
            this.resetWatchdog();
          }
          if (this.enabled && !this.scheduled) {
            this.cpu.addClockEvent(this.checkWatchdog, this.watchdogTimeout - this.cpu.cycles);
          }
          this.cpu.clearInterruptByFlag(this.Watchdog, value);
          return true;
        };
      }
      resetWatchdog() {
        const cycles = Math.floor(this.clock.frequency / this.clockFrequency * this.prescaler);
        this.watchdogTimeout = this.cpu.cycles + cycles;
      }
      get enabled() {
        return this.enabledValue;
      }
      /**
       * The base clock frequency is 128KHz. Thus, a prescaler of 2048 gives 16ms timeout.
       */
      get prescaler() {
        const wdtcsr = this.cpu.data[this.config.WDTCSR];
        const value = (wdtcsr & WDTCSR_WDP3) >> 2 | wdtcsr & WDTCSR_WDP210;
        return 2048 << value;
      }
    };
    exports.AVRWatchdog = AVRWatchdog;
  }
});

// ../simulab-engine/node_modules/avr8js/dist/cjs/index.js
var require_cjs = __commonJS({
  "../simulab-engine/node_modules/avr8js/dist/cjs/index.js"(exports) {
    "use strict";
    var __createBinding = exports && exports.__createBinding || (Object.create ? (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      var desc = Object.getOwnPropertyDescriptor(m, k);
      if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
        desc = { enumerable: true, get: function() {
          return m[k];
        } };
      }
      Object.defineProperty(o, k2, desc);
    }) : (function(o, m, k, k2) {
      if (k2 === void 0) k2 = k;
      o[k2] = m[k];
    }));
    var __exportStar = exports && exports.__exportStar || function(m, exports2) {
      for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p)) __createBinding(exports2, m, p);
    };
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.watchdogConfig = exports.AVRWatchdog = exports.AVRUSI = exports.usart0Config = exports.AVRUSART = exports.attinyTimer1Config = exports.ATtinyTimer1 = exports.timer2Config = exports.timer1Config = exports.timer0Config = exports.AVRTimer = exports.spiConfig = exports.AVRSPI = exports.portLConfig = exports.portKConfig = exports.portJConfig = exports.portHConfig = exports.portGConfig = exports.portFConfig = exports.portEConfig = exports.portDConfig = exports.portCConfig = exports.portBConfig = exports.portAConfig = exports.PinState = exports.PCINT2 = exports.PCINT1 = exports.PCINT0 = exports.INT1 = exports.INT0 = exports.AVRIOPort = exports.eepromConfig = exports.EEPROMMemoryBackend = exports.AVREEPROM = exports.clockConfig = exports.AVRClock = exports.atmega328Channels = exports.adcConfig = exports.AVRADC = exports.ADCReference = exports.ADCMuxInputType = exports.avrInterrupt = exports.avrInstruction = exports.CPU = void 0;
    var cpu_1 = require_cpu();
    Object.defineProperty(exports, "CPU", { enumerable: true, get: function() {
      return cpu_1.CPU;
    } });
    var instruction_1 = require_instruction();
    Object.defineProperty(exports, "avrInstruction", { enumerable: true, get: function() {
      return instruction_1.avrInstruction;
    } });
    var interrupt_1 = require_interrupt();
    Object.defineProperty(exports, "avrInterrupt", { enumerable: true, get: function() {
      return interrupt_1.avrInterrupt;
    } });
    var adc_1 = require_adc();
    Object.defineProperty(exports, "ADCMuxInputType", { enumerable: true, get: function() {
      return adc_1.ADCMuxInputType;
    } });
    Object.defineProperty(exports, "ADCReference", { enumerable: true, get: function() {
      return adc_1.ADCReference;
    } });
    Object.defineProperty(exports, "AVRADC", { enumerable: true, get: function() {
      return adc_1.AVRADC;
    } });
    Object.defineProperty(exports, "adcConfig", { enumerable: true, get: function() {
      return adc_1.adcConfig;
    } });
    Object.defineProperty(exports, "atmega328Channels", { enumerable: true, get: function() {
      return adc_1.atmega328Channels;
    } });
    var clock_1 = require_clock();
    Object.defineProperty(exports, "AVRClock", { enumerable: true, get: function() {
      return clock_1.AVRClock;
    } });
    Object.defineProperty(exports, "clockConfig", { enumerable: true, get: function() {
      return clock_1.clockConfig;
    } });
    var eeprom_1 = require_eeprom();
    Object.defineProperty(exports, "AVREEPROM", { enumerable: true, get: function() {
      return eeprom_1.AVREEPROM;
    } });
    Object.defineProperty(exports, "EEPROMMemoryBackend", { enumerable: true, get: function() {
      return eeprom_1.EEPROMMemoryBackend;
    } });
    Object.defineProperty(exports, "eepromConfig", { enumerable: true, get: function() {
      return eeprom_1.eepromConfig;
    } });
    var gpio_1 = require_gpio();
    Object.defineProperty(exports, "AVRIOPort", { enumerable: true, get: function() {
      return gpio_1.AVRIOPort;
    } });
    Object.defineProperty(exports, "INT0", { enumerable: true, get: function() {
      return gpio_1.INT0;
    } });
    Object.defineProperty(exports, "INT1", { enumerable: true, get: function() {
      return gpio_1.INT1;
    } });
    Object.defineProperty(exports, "PCINT0", { enumerable: true, get: function() {
      return gpio_1.PCINT0;
    } });
    Object.defineProperty(exports, "PCINT1", { enumerable: true, get: function() {
      return gpio_1.PCINT1;
    } });
    Object.defineProperty(exports, "PCINT2", { enumerable: true, get: function() {
      return gpio_1.PCINT2;
    } });
    Object.defineProperty(exports, "PinState", { enumerable: true, get: function() {
      return gpio_1.PinState;
    } });
    Object.defineProperty(exports, "portAConfig", { enumerable: true, get: function() {
      return gpio_1.portAConfig;
    } });
    Object.defineProperty(exports, "portBConfig", { enumerable: true, get: function() {
      return gpio_1.portBConfig;
    } });
    Object.defineProperty(exports, "portCConfig", { enumerable: true, get: function() {
      return gpio_1.portCConfig;
    } });
    Object.defineProperty(exports, "portDConfig", { enumerable: true, get: function() {
      return gpio_1.portDConfig;
    } });
    Object.defineProperty(exports, "portEConfig", { enumerable: true, get: function() {
      return gpio_1.portEConfig;
    } });
    Object.defineProperty(exports, "portFConfig", { enumerable: true, get: function() {
      return gpio_1.portFConfig;
    } });
    Object.defineProperty(exports, "portGConfig", { enumerable: true, get: function() {
      return gpio_1.portGConfig;
    } });
    Object.defineProperty(exports, "portHConfig", { enumerable: true, get: function() {
      return gpio_1.portHConfig;
    } });
    Object.defineProperty(exports, "portJConfig", { enumerable: true, get: function() {
      return gpio_1.portJConfig;
    } });
    Object.defineProperty(exports, "portKConfig", { enumerable: true, get: function() {
      return gpio_1.portKConfig;
    } });
    Object.defineProperty(exports, "portLConfig", { enumerable: true, get: function() {
      return gpio_1.portLConfig;
    } });
    var spi_1 = require_spi();
    Object.defineProperty(exports, "AVRSPI", { enumerable: true, get: function() {
      return spi_1.AVRSPI;
    } });
    Object.defineProperty(exports, "spiConfig", { enumerable: true, get: function() {
      return spi_1.spiConfig;
    } });
    var timer_1 = require_timer();
    Object.defineProperty(exports, "AVRTimer", { enumerable: true, get: function() {
      return timer_1.AVRTimer;
    } });
    Object.defineProperty(exports, "timer0Config", { enumerable: true, get: function() {
      return timer_1.timer0Config;
    } });
    Object.defineProperty(exports, "timer1Config", { enumerable: true, get: function() {
      return timer_1.timer1Config;
    } });
    Object.defineProperty(exports, "timer2Config", { enumerable: true, get: function() {
      return timer_1.timer2Config;
    } });
    var timer_attiny_1 = require_timer_attiny();
    Object.defineProperty(exports, "ATtinyTimer1", { enumerable: true, get: function() {
      return timer_attiny_1.ATtinyTimer1;
    } });
    Object.defineProperty(exports, "attinyTimer1Config", { enumerable: true, get: function() {
      return timer_attiny_1.attinyTimer1Config;
    } });
    __exportStar(require_twi(), exports);
    var usart_1 = require_usart();
    Object.defineProperty(exports, "AVRUSART", { enumerable: true, get: function() {
      return usart_1.AVRUSART;
    } });
    Object.defineProperty(exports, "usart0Config", { enumerable: true, get: function() {
      return usart_1.usart0Config;
    } });
    var usi_1 = require_usi();
    Object.defineProperty(exports, "AVRUSI", { enumerable: true, get: function() {
      return usi_1.AVRUSI;
    } });
    var watchdog_1 = require_watchdog();
    Object.defineProperty(exports, "AVRWatchdog", { enumerable: true, get: function() {
      return watchdog_1.AVRWatchdog;
    } });
    Object.defineProperty(exports, "watchdogConfig", { enumerable: true, get: function() {
      return watchdog_1.watchdogConfig;
    } });
  }
});

// ../simulab-engine/src/avrProfiles.ts
var import_avr8js = __toESM(require_cjs(), 1);
var unoMap = Object.fromEntries([...Array.from({ length: 8 }, (_, i) => [`D${i}`, ["D", i]]), ...Array.from({ length: 6 }, (_, i) => [`D${8 + i}`, ["B", i]]), ...Array.from({ length: 6 }, (_, i) => [`A${i}`, ["C", i]])]);
var digital = [["E", 0], ["E", 1], ["E", 4], ["E", 5], ["G", 5], ["E", 3], ["H", 3], ["H", 4], ["H", 5], ["H", 6], ["B", 4], ["B", 5], ["B", 6], ["B", 7], ["J", 1], ["J", 0], ["H", 1], ["H", 0], ["D", 3], ["D", 2], ["D", 1], ["D", 0], ...Array.from({ length: 8 }, (_, i) => ["A", i]), ...Array.from({ length: 8 }, (_, i) => ["C", 7 - i]), ["D", 7], ["G", 2], ["G", 1], ["G", 0], ...Array.from({ length: 8 }, (_, i) => ["L", 7 - i]), ["B", 3], ["B", 2], ["B", 1], ["B", 0]];
var megaMap = Object.fromEntries([...digital.map((p, i) => [`D${i}`, p]), ...Array.from({ length: 16 }, (_, i) => [`A${i}`, [i < 8 ? "F" : "K", i % 8]])]);
var ext = (index) => ({ EICR: index < 4 ? 105 : 106, EIMSK: 61, EIFR: 60, index, iscOffset: index % 4 * 2, interrupt: (index + 1) * 2 });
var pc = (index, mask = 255, offset = 0) => ({ PCIE: index, PCICR: 104, PCIFR: 59, PCMSK: 107 + index, pinChangeInterrupt: (9 + index) * 2, mask, offset });
var clean = (p) => ({ PIN: p.PIN, DDR: p.DDR, PORT: p.PORT, externalInterrupts: [] });
var megaPorts = { A: clean(import_avr8js.portAConfig), B: { ...clean(import_avr8js.portBConfig), pinChange: pc(0) }, C: clean(import_avr8js.portCConfig), D: { ...clean(import_avr8js.portDConfig), externalInterrupts: [ext(0), ext(1), ext(2), ext(3)] }, E: { ...clean(import_avr8js.portEConfig), pinChange: pc(1, 1), externalInterrupts: [null, null, null, null, ext(4), ext(5), ext(6), ext(7)] }, F: clean(import_avr8js.portFConfig), G: clean(import_avr8js.portGConfig), H: clean(import_avr8js.portHConfig), J: { ...clean(import_avr8js.portJConfig), pinChange: pc(1, 127, 1) }, K: { ...clean(import_avr8js.portKConfig), pinChange: pc(2) }, L: clean(import_avr8js.portLConfig) };
var t1 = { ...import_avr8js.timer1Config, captureInterrupt: 32, compAInterrupt: 34, compBInterrupt: 36, compCInterrupt: 38, ovfInterrupt: 40, OCRC: 140, OCFC: 8, OCIEC: 8, compPortA: import_avr8js.portBConfig.PORT, compPinA: 5, compPortB: import_avr8js.portBConfig.PORT, compPinB: 6, compPortC: import_avr8js.portBConfig.PORT, compPinC: 7, externalClockPort: import_avr8js.portDConfig.PORT, externalClockPin: 6 };
var timer16 = (base, mask, flag, vector, port, pins3, extPort, extPin) => ({ ...t1, TCCRA: base, TCCRB: base + 1, TCCRC: base + 2, TCNT: base + 4, ICR: base + 6, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12, TIMSK: mask, TIFR: flag, captureInterrupt: vector * 2, compAInterrupt: (vector + 1) * 2, compBInterrupt: (vector + 2) * 2, compCInterrupt: (vector + 3) * 2, ovfInterrupt: (vector + 4) * 2, compPortA: port, compPortB: port, compPortC: port, compPinA: pins3[0], compPinB: pins3[1], compPinC: pins3[2], externalClockPort: extPort, externalClockPin: extPin });
function avrProfile(chip = "atmega328p") {
  if (chip === "atmega328p") return { chip, flashBytes: 32768, sramAllocation: 2048, pins: unoMap, ports: { B: import_avr8js.portBConfig, C: import_avr8js.portCConfig, D: import_avr8js.portDConfig }, timers: [import_avr8js.timer0Config, import_avr8js.timer1Config, import_avr8js.timer2Config], uart: import_avr8js.usart0Config, twi: import_avr8js.twiConfig };
  if (chip !== "atmega2560") throw new Error("Unsupported AVR chip profile");
  return { chip, flashBytes: 262144, sramAllocation: 8192 + 256, pins: megaMap, ports: megaPorts, timers: [{ ...import_avr8js.timer0Config, compAInterrupt: 42, compBInterrupt: 44, ovfInterrupt: 46, compPortA: import_avr8js.portBConfig.PORT, compPinA: 7, compPortB: import_avr8js.portGConfig.PORT, compPinB: 5, externalClockPort: import_avr8js.portDConfig.PORT, externalClockPin: 7 }, t1, { ...import_avr8js.timer2Config, compAInterrupt: 26, compBInterrupt: 28, ovfInterrupt: 30, compPortA: import_avr8js.portBConfig.PORT, compPinA: 4, compPortB: import_avr8js.portHConfig.PORT, compPinB: 6 }, timer16(144, 113, 56, 31, import_avr8js.portEConfig.PORT, [3, 4, 5], import_avr8js.portEConfig.PORT, 6), timer16(160, 114, 57, 41, import_avr8js.portHConfig.PORT, [3, 4, 5], import_avr8js.portHConfig.PORT, 7), timer16(288, 115, 58, 46, import_avr8js.portLConfig.PORT, [3, 4, 5], import_avr8js.portLConfig.PORT, 2)], uart: { ...import_avr8js.usart0Config, rxCompleteInterrupt: 50, dataRegisterEmptyInterrupt: 52, txCompleteInterrupt: 54 }, twi: { ...import_avr8js.twiConfig, twiInterrupt: 78 } };
}

// ../simulab-engine/src/uno.ts
var import_avr8js2 = __toESM(require_cjs(), 1);

// ../simulab-engine/src/types.ts
var RuntimeError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "RuntimeError";
  }
  code;
};
var ENGINE_CONTRACT_VERSION = "1.0.0";
var UNO_CLOCK_HZ = 16e6;
var capabilities = Object.freeze({
  engine: "avr8js",
  engineVersion: "0.21.1",
  board: "arduino-uno",
  mcu: "atmega328p",
  clockHz: UNO_CLOCK_HZ,
  firmwareFormats: ["intel-hex"],
  gpio: true,
  uartTx: true,
  timers: [0, 1, 2],
  unverifiedTimers: [],
  pwm: true,
  i2c: false,
  spi: false,
  adc: false,
  uartRx: true
});

// ../simulab-engine/src/hex.ts
var fail = (message) => {
  throw new RuntimeError("INVALID_FIRMWARE", message);
};
function parseIntelHex(hex, flashBytes = 32768) {
  if (![32768, 262144].includes(flashBytes)) fail("Unsupported AVR flash profile.");
  const label = flashBytes === 32768 ? "ATmega328P" : "ATmega2560";
  if (typeof hex !== "string" || hex.length > flashBytes * 4 || !hex.trim())
    fail(`Firmware must contain at most ${flashBytes * 4} bytes of Intel HEX text.`);
  if (!/^[\x09\x0a\x0d\x20-\x7e]*$/.test(hex))
    fail("Firmware must use ASCII Intel HEX.");
  const flash = new Uint8Array(flashBytes).fill(255), written = new Uint8Array(flashBytes);
  let base = 0, eof = false, dataBytes = 0;
  for (const raw of hex.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (eof) fail("Unexpected record after EOF.");
    if (!/^:[0-9a-fA-F]+$/.test(line) || line.length < 11 || (line.length - 1) % 2)
      fail("Malformed Intel HEX record.");
    const bytes = Uint8Array.from(
      line.slice(1).match(/../g),
      (v) => parseInt(v, 16)
    );
    const length = bytes[0], address = bytes[1] << 8 | bytes[2], type = bytes[3];
    if (bytes.length !== length + 5) fail("Intel HEX record length mismatch.");
    if (bytes.reduce((a, b) => a + b, 0) % 256 !== 0)
      fail("Intel HEX checksum mismatch.");
    if (type === 0) {
      if (!length) fail("Empty data records are not supported.");
      const start = base + address;
      if (start + length > flash.length)
        fail(`Firmware exceeds ${label} flash bounds.`);
      for (let i = 0; i < length; i++) {
        if (written[start + i]) fail("Overlapping firmware data.");
        flash[start + i] = bytes[4 + i];
        written[start + i] = 1;
        dataBytes++;
      }
    } else if (type === 1) {
      if (length !== 0 || address !== 0) fail("Invalid EOF record.");
      eof = true;
    } else if (type === 2 || type === 4) {
      if (length !== 2 || address !== 0)
        fail("Invalid extended-address record.");
      base = (bytes[4] << 8 | bytes[5]) * (type === 2 ? 16 : 65536);
      if (base >= flash.length)
        fail(`Extended address exceeds ${label} flash.`);
    } else fail(`Unsupported Intel HEX record type ${type}.`);
  }
  if (!eof) fail("Missing Intel HEX EOF record.");
  if (!dataBytes || !written[0] || !written[1])
    fail("Firmware has no reset-vector instruction.");
  return flash;
}

// ../simulab-engine/src/opcodes.ts
var masks = [
  [64512, 7168],
  [64512, 3072],
  [65280, 38400],
  [64512, 8192],
  [61440, 28672],
  [65039, 37893],
  [65423, 38024],
  [65032, 63488],
  [64512, 62464],
  [64512, 61440],
  [65423, 37896],
  [65032, 64e3],
  [65038, 37902],
  [65280, 38912],
  [65039, 37888],
  [64512, 5120],
  [64512, 1024],
  [61440, 12288],
  [64512, 4096],
  [65039, 37898],
  [65039, 36870],
  [65039, 36871],
  [64512, 9216],
  [65416, 776],
  [65416, 896],
  [65416, 904],
  [63488, 45056],
  [65039, 37891],
  [65038, 37900],
  [65039, 37382],
  [65039, 37381],
  [65039, 37383],
  [61440, 57344],
  [65039, 36864],
  [65039, 36876],
  [65039, 36877],
  [65039, 36878],
  [65039, 32776],
  [65039, 36873],
  [65039, 36874],
  [53768, 32776],
  [65039, 32768],
  [65039, 36865],
  [65039, 36866],
  [53768, 32768],
  [65039, 36868],
  [65039, 36869],
  [65039, 37894],
  [64512, 11264],
  [65280, 256],
  [64512, 39936],
  [65280, 512],
  [65416, 768],
  [65039, 37889],
  [64512, 10240],
  [61440, 24576],
  [63488, 47104],
  [65039, 36879],
  [65039, 37391],
  [61440, 53248],
  [61440, 49152],
  [65039, 37895],
  [64512, 2048],
  [61440, 16384],
  [65280, 39424],
  [65280, 39168],
  [65280, 39680],
  [65280, 38656],
  [65032, 64512],
  [65032, 65024],
  [65039, 37376],
  [65039, 37388],
  [65039, 37389],
  [65039, 37390],
  [65039, 33288],
  [65039, 37385],
  [65039, 37386],
  [53768, 33288],
  [65039, 33280],
  [65039, 37377],
  [65039, 37378],
  [53768, 33280],
  [64512, 6144],
  [61440, 20480],
  [65039, 37890],
  [65039, 37380]
];
var exact = /* @__PURE__ */ new Set([
  38169,
  37913,
  38360,
  38153,
  37897,
  38344,
  0,
  38152,
  38168,
  38280,
  38376,
  38392,
  38312
]);
function isRecognizedOpcode(opcode) {
  return Number.isInteger(opcode) && opcode >= 0 && opcode <= 65535 && (exact.has(opcode) || masks.some(([mask, value]) => (opcode & mask) === value));
}

// ../simulab-engine/src/uno.ts
var AvrRuntime = class {
  constructor(hex, options = {}) {
    this.options = options;
    this.profile = avrProfile(options.mcu);
    this.flash = parseIntelHex(hex, this.profile.flashBytes);
    this.initialize();
  }
  options;
  profile;
  flash;
  cpu;
  ports;
  state = "ready";
  serial = "";
  transitions = [];
  levels = {};
  uart;
  rxQueue = [];
  initialize() {
    const words = new Uint16Array(this.profile.flashBytes / 2);
    for (let i = 0; i < words.length; i++)
      words[i] = this.flash[i * 2] | this.flash[i * 2 + 1] << 8;
    this.cpu = new import_avr8js2.CPU(words, this.profile.sramAllocation);
    this.ports = Object.fromEntries(Object.entries(this.profile.ports).map(([name, cfg]) => [name, new import_avr8js2.AVRIOPort(this.cpu, cfg)]));
    for (const port of Object.values(this.ports)) {
      const addr = port.portConfig.PIN;
      this.cpu.readHooks[addr] = () => {
        this.options.onBeforeInputRead?.(this.cpu.cycles / 16, this.readLevels());
        return this.cpu.data[addr];
      };
    }
    for (const cfg of this.profile.timers) new import_avr8js2.AVRTimer(this.cpu, cfg);
    const uart = new import_avr8js2.AVRUSART(this.cpu, this.profile.uart, UNO_CLOCK_HZ);
    this.uart = uart;
    this.rxQueue = [];
    const twi = new import_avr8js2.AVRTWI(this.cpu, this.profile.twi, UNO_CLOCK_HZ);
    let address = 0, bytes = [];
    const syncBus = () => this.options.onBeforeInputRead?.(this.cpu.cycles / 16, this.readLevels());
    twi.eventHandler = {
      start: () => {
        bytes = [];
        twi.completeStart();
      },
      stop: () => {
        bytes = [];
        twi.completeStop();
      },
      connectToSlave: (addr) => {
        syncBus();
        address = addr;
        bytes = [];
        twi.completeConnect(this.options.i2c?.write(addr, []) ?? false);
      },
      writeByte: (value) => {
        syncBus();
        bytes.push(value);
        twi.completeWrite(this.options.i2c?.write(address, bytes) ?? false);
      },
      readByte: () => {
        syncBus();
        twi.completeRead(this.options.i2c?.read(address, 1)[0] ?? 255);
      }
    };
    uart.onByteTransmit = (byte) => {
      if (this.serial.length >= 4096)
        throw new RuntimeError(
          "OUTPUT_LIMIT",
          "UART output exceeds 4096-byte batch limit."
        );
      this.serial += String.fromCharCode(byte);
    };
    this.serial = "";
    this.transitions = [];
    this.levels = this.readLevels();
    for (const port of Object.values(this.ports))
      port.addListener(() => this.captureTransitions());
    this.state = "ready";
  }
  readLevels() {
    const result = {};
    for (const [pin2, [port, bit]] of Object.entries(this.profile.pins)) {
      const state = this.ports[port].pinState(bit);
      result[pin2] = state === import_avr8js2.PinState.High ? 1 : state === import_avr8js2.PinState.Low ? 0 : null;
    }
    return result;
  }
  captureTransitions() {
    const now = this.readLevels();
    const pending = [];
    for (const pin2 of Object.keys(now)) {
      if (now[pin2] !== this.levels[pin2]) {
        if (this.transitions.length >= 4096)
          throw new RuntimeError(
            "OUTPUT_LIMIT",
            "GPIO output exceeds 4096-transition batch limit."
          );
        const event = { pin: pin2, level: now[pin2], cycle: this.cpu.cycles };
        this.transitions.push(event);
        pending.push(event);
      }
    }
    this.levels = now;
    for (const event of pending) this.options.onGpioTransition?.(event, now);
  }
  /** @brief Begin a loaded CPU; restarting a stopped CPU initializes fresh power-on state. */
  start() {
    if (this.state !== "ready" && this.state !== "stopped")
      throw new RuntimeError(
        "INVALID_STATE",
        "Start requires a ready or stopped runtime."
      );
    if (this.state === "stopped") this.initialize();
    this.state = "running";
  }
  pause() {
    if (this.state !== "running")
      throw new RuntimeError(
        "INVALID_STATE",
        "Pause requires a running runtime."
      );
    this.state = "paused";
  }
  resume() {
    if (this.state !== "paused")
      throw new RuntimeError(
        "INVALID_STATE",
        "Resume requires a paused runtime."
      );
    this.state = "running";
  }
  stop() {
    this.state = "stopped";
  }
  /** @brief Restore original flash, zero cycles and fresh AVR peripherals. */
  reset() {
    this.initialize();
  }
  /** @brief Apply an external digital input, including interrupt-enabled pins. Output pins remain MCU-driven. */
  setPin(pin2, value) {
    if (typeof value !== "boolean" || !Object.hasOwn(this.profile.pins, pin2))
      throw new RuntimeError(
        "INVALID_INPUT",
        "Expected a Uno digital pin and boolean input."
      );
    const [port, bit] = this.profile.pins[pin2];
    this.ports[port].setPin(bit, value);
  }
  /** @brief Apply a resolved external digital level. Floating inputs use the AVR pull-up state (otherwise deterministic LOW).
   * @details This fallback does not establish a physically valid floating voltage; the circuit host reports ambiguity.
   */
  setPinLevel(pin2, level) {
    if (!this.profile.pins[pin2]) throw new RuntimeError("INVALID_PIN", "Unknown AVR pin");
    const [port, bit] = this.profile.pins[pin2];
    this.setPin(pin2, level === null ? this.ports[port].pinState(bit) === import_avr8js2.PinState.InputPullUp : level === 1);
  }
  /** @brief Execute real instructions until cycle budget is reached; one instruction can cross the boundary. */
  runCycles(budget) {
    if (this.state !== "running")
      throw new RuntimeError(
        "INVALID_STATE",
        "CPU must be running to execute cycles."
      );
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 25e4)
      throw new RuntimeError(
        "INVALID_BUDGET",
        "Cycle budget must be an integer from 1 to 250000."
      );
    const end = this.cpu.cycles + budget;
    try {
      while (this.cpu.cycles < end) {
        const opcode = this.cpu.progMem[this.cpu.pc];
        if (!isRecognizedOpcode(opcode))
          throw new RuntimeError(
            "UNSUPPORTED_OPCODE",
            `Unsupported AVR opcode 0x${opcode?.toString(16)} at byte ${this.cpu.pc * 2}.`
          );
        if ([38280, 38376, 38392, 38312, 38296].includes(opcode))
          throw new RuntimeError(
            "UNSUPPORTED_OPERATION",
            "Sleep, self-programming, watchdog and debug-break operations are unsupported."
          );
        (0, import_avr8js2.avrInstruction)(this.cpu);
        this.cpu.tick();
        if (this.rxQueue.length && this.uart.rxEnable && !this.uart.rxBusy) {
          if (this.uart.writeByte(this.rxQueue[0])) this.rxQueue.shift();
        }
      }
    } catch (error) {
      this.state = "stopped";
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError(
        "EXECUTION_ERROR",
        error instanceof Error ? error.message : "AVR execution failed."
      );
    }
    return this.snapshot();
  }
  /** @brief Queue bounded external UART bytes for the real AVR USART peripheral. */
  uartInput(bytes) {
    if (!(bytes instanceof Uint8Array) || this.rxQueue.length + bytes.length > 4096) throw new RuntimeError("INPUT_LIMIT", "UART input exceeds 4096 bytes");
    this.rxQueue.push(...bytes);
  }
  /** @brief Inspect real CPU registers. PC is a byte address; no source mapping is implied. */
  debugSnapshot() {
    return { pcBytes: this.cpu.pc * 2, sp: this.cpu.dataView.getUint16(93, true), sreg: this.cpu.data[95], registers: Array.from(this.cpu.data.slice(0, 32)) };
  }
  /** @brief Execute exactly one real instruction from ready/paused state. */
  stepInstruction() {
    if (!["ready", "paused"].includes(this.state)) throw new RuntimeError("INVALID_STATE", "Pause before stepping");
    this.state = "running";
    const s = this.runCycles(1);
    this.state = "paused";
    s.state = "paused";
    return s;
  }
  /** @brief Read current cycle-derived state, draining bounded event and UART batches. */
  snapshot() {
    const result = {
      cycles: this.cpu.cycles,
      timeMicros: this.cpu.cycles / (UNO_CLOCK_HZ / 1e6),
      state: this.state,
      gpio: this.readLevels(),
      serial: this.serial,
      transitions: this.transitions
    };
    this.serial = "";
    this.transitions = [];
    return result;
  }
};
var UnoRuntime = class extends AvrRuntime {
  constructor(hex, options = {}) {
    super(hex, { ...options, mcu: "atmega328p" });
  }
};

// ../simulab-engine/esp32/adapter.mjs
var ESP_EMULATOR_VERSION = "0.51.0";
var ABSENT = /* @__PURE__ */ new Set([22, 23, 24, 25]);
var RESERVED_N16R8 = /* @__PURE__ */ new Set([
  26,
  27,
  28,
  29,
  30,
  31,
  32,
  33,
  34,
  35,
  36,
  37
]);
function validateMergedFlash(data) {
  if (!(data instanceof Uint8Array) || data.byteLength < 65568 || data.byteLength > 16 * 1024 * 1024 || data[0] !== 233)
    throw new Error(
      "Expected merged ESP-IDF flash image, at most16MiB, including bootloader/table/application."
    );
  if ((data[12] | data[13] << 8) !== 9)
    throw new Error("Firmware image must target ESP32-S3 (chip ID9).");
  if (data[32768] !== 170 || data[32769] !== 80)
    throw new Error(
      "Standard IDF partition table at flash0x8000 is required; app-only binaries are unsupported."
    );
  if (data[65536] !== 233)
    throw new Error(
      "Initial profile requires an application image at flash0x10000."
    );
  return data;
}
function decodeGPIO(words) {
  if (!words || words.length !== 4)
    throw new Error("Invalid ESP-EMU GPIO register snapshot.");
  const gpio = {};
  for (let pin2 = 0; pin2 <= 48; pin2++) {
    if (ABSENT.has(pin2)) continue;
    const bank = pin2 >= 32 ? 1 : 0;
    const mask = 1 << pin2 % 32;
    gpio[`GPIO${pin2}`] = (words[bank + 2] & mask) !== 0 ? (words[bank] & mask) !== 0 ? 1 : 0 : null;
  }
  return gpio;
}
var Esp32S3Runtime = class {
  #binding;
  #machine;
  #firmware;
  #state = "empty";
  #serial = "";
  #transitions = [];
  #levels = {};
  #uartListeners = /* @__PURE__ */ new Set();
  #gpioListeners = /* @__PURE__ */ new Set();
  constructor(bindings, firmware) {
    if (typeof bindings?.WasmEmulator !== "function")
      throw new Error(
        "An initialized official ESP-EMU WASM binding is required."
      );
    this.#binding = bindings;
    if (firmware) this.loadFirmware(firmware);
  }
  #requireMachine() {
    if (!this.#machine)
      throw new Error("Load compatible ESP32-S3 firmware first.");
    return this.#machine;
  }
  #initialize() {
    this.#machine?.free();
    this.#machine = void 0;
    const machine = new this.#binding.WasmEmulator("esp32s3");
    try {
      if (!machine.is_xtensa() || machine.num_harts() < 1 || machine.num_harts() > 2)
        throw new Error("Binding did not initialize ESP32-S3 Xtensa LX7.");
      if (!machine.has_default_rom())
        throw new Error(
          "Official ESP32-S3 ROM is unavailable in this binding."
        );
      machine.load_default_rom();
      machine.set_boot_from_rom(true);
      machine.load_firmware(this.#firmware);
      this.#machine = machine;
      this.#state = "ready";
      this.#serial = "";
      this.#transitions = [];
      this.#levels = decodeGPIO(machine.gpio_state());
    } catch (error) {
      machine.free();
      throw error;
    }
  }
  loadFirmware(data) {
    this.#firmware = new Uint8Array(validateMergedFlash(data));
    this.#initialize();
  }
  start() {
    this.#requireMachine();
    if (!["ready", "stopped"].includes(this.#state))
      throw new Error("Start requires ready or stopped firmware.");
    if (this.#state === "stopped") this.#initialize();
    this.#state = "running";
  }
  pause() {
    if (this.#state !== "running")
      throw new Error("Pause requires running firmware.");
    this.#state = "paused";
  }
  resume() {
    if (this.#state !== "paused")
      throw new Error("Resume requires paused firmware.");
    this.#state = "running";
  }
  stop() {
    this.#requireMachine();
    this.#state = "stopped";
  }
  reset() {
    this.#requireMachine();
    this.#initialize();
  }
  getState() {
    return this.#state;
  }
  getDiagnostics() {
    const m = this.#requireMachine();
    const count = m.num_harts();
    return {
      isXtensa: m.is_xtensa(),
      reportedHarts: count,
      programCounters: Array.from({ length: count }, (_, i) => m.hart_pc(i)),
      clockMHz: m.cycles_per_us()
    };
  }
  getGPIOState() {
    return decodeGPIO(this.#requireMachine().gpio_state());
  }
  getSimulationTime() {
    const machine = this.#requireMachine();
    return machine.cycles() / machine.cycles_per_us();
  }
  setGPIOInput(pin2, value) {
    if (!Number.isInteger(pin2) || pin2 < 0 || pin2 > 48 || ABSENT.has(pin2) || typeof value !== "boolean")
      throw new Error(
        "Expected an available ESP32-S3 GPIO number and boolean level."
      );
    if (RESERVED_N16R8.has(pin2))
      throw new Error(
        "GPIO is flash/PSRAM reserved for the N16R8 board profile."
      );
    this.#requireMachine().gpio_set_input(pin2, value);
  }
  setPin(pin2, value) {
    if (typeof pin2 !== "string" || !/^GPIO(?:[0-9]|[1-4][0-9])$/.test(pin2))
      throw new Error(
        "ESP32-S3 input names must use GPIO<number>; AVR pin names are not accepted."
      );
    this.setGPIOInput(Number(pin2.slice(4)), value);
  }
  uartInput(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > 4096)
      throw new Error("UART input must be at most4096 bytes.");
    this.#requireMachine().uart_input(bytes);
  }
  subscribeGPIOChanges(listener) {
    if (typeof listener !== "function")
      throw new Error("GPIO subscriber must be a function.");
    this.#gpioListeners.add(listener);
    return () => this.#gpioListeners.delete(listener);
  }
  subscribeUART(listener) {
    if (typeof listener !== "function")
      throw new Error("UART subscriber must be a function.");
    this.#uartListeners.add(listener);
    return () => this.#uartListeners.delete(listener);
  }
  /** @brief Compatibility alias: budget is instructions, not cycles. Returned time uses actual emulator cycles. */
  runCycles(budget) {
    return this.runBatch(budget);
  }
  runBatch(budget) {
    if (this.#state !== "running")
      throw new Error("ESP32-S3 must be running before instruction execution.");
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 1e5)
      throw new Error("Instruction budget must be an integer1..100000.");
    const machine = this.#requireMachine();
    try {
      const text3 = machine.run_batch(budget);
      if (typeof text3 !== "string" || text3.length > 4096)
        throw new Error("UART batch exceeds4096 bytes.");
      this.#serial += text3;
      if (this.#serial.length > 4096)
        throw new Error("UART pending buffer exceeds4096 bytes.");
      if (text3) for (const listener of this.#uartListeners) listener(text3);
      const current = decodeGPIO(machine.gpio_state());
      const cycle = machine.cycles();
      for (const pin2 of Object.keys(current)) {
        if (current[pin2] !== this.#levels[pin2]) {
          const change = { pin: pin2, level: current[pin2], cycle };
          this.#transitions.push(change);
          for (const listener of this.#gpioListeners) listener(change);
        }
      }
      this.#levels = current;
      if (machine.needs_restart()) {
        machine.restart();
        this.#levels = decodeGPIO(machine.gpio_state());
      }
      return this.snapshot();
    } catch (error) {
      this.#state = "stopped";
      throw error;
    }
  }
  snapshot() {
    const machine = this.#requireMachine();
    const snapshot = {
      cycles: machine.cycles(),
      timeMicros: this.getSimulationTime(),
      state: this.#state,
      gpio: this.getGPIOState(),
      serial: this.#serial,
      transitions: this.#transitions
    };
    this.#serial = "";
    this.#transitions = [];
    return snapshot;
  }
  /** @brief Official browser APIs are available; capability presence is separate from firmware acceptance evidence. */
  getCapabilities() {
    return {
      engine: "espressif/esp-emulator",
      version: ESP_EMULATOR_VERSION,
      mcu: "esp32s3",
      architecture: "Xtensa LX7",
      cores: 2,
      budgetUnit: "instructions",
      firmwareFormats: ["esp-idf-merged-flash-standard-offsets"],
      gpio: true,
      uartTx: true,
      uartRx: true,
      clock: "cycles()/cycles_per_us()",
      gpioChanges: "sampled at batch boundaries; not edge callbacks",
      flashPsramOverride: false,
      peripherals: {
        i2cExternalDevice: false,
        spiExternalDevice: false,
        rmtWaveform: false,
        ws2812: false
      },
      physicalHardwareValidated: false
    };
  }
  attachI2CDevice() {
    throw new Error(
      "External I2C device callbacks are unsupported by this official browser binding."
    );
  }
  dispose() {
    this.#machine?.free();
    this.#machine = void 0;
    this.#firmware = void 0;
    this.#state = "empty";
    this.#uartListeners.clear();
    this.#gpioListeners.clear();
  }
};

// ../simulab-frontend/src/circuit/boardRegistry.ts
var mcuKinds = ["uno", "nano", "mega2560", "yd-esp32-s3"];
function isMcuKind(kind) {
  return mcuKinds.includes(kind);
}
function boardTarget(kind) {
  return kind === "yd-esp32-s3" ? "esp32s3" : kind === "uno" || kind === "nano" || kind === "mega2560" ? kind : void 0;
}
function boardPins(kind) {
  const digital2 = kind === "mega2560" ? 54 : 14, analog = kind === "mega2560" ? 16 : kind === "nano" ? 8 : 6;
  return [
    ...Array.from({ length: digital2 }, (_, i) => ({
      id: `D${i}`,
      label: `D${i}`,
      electricalType: "bidirectional",
      digital: true
    })),
    ...Array.from({ length: analog }, (_, i) => ({
      id: `A${i}`,
      label: `A${i}`,
      electricalType: kind === "nano" && i > 5 ? "adc-only-unimplemented" : "analog",
      digital: !(kind === "nano" && i > 5)
    })),
    ...["5V", "3V3", "GND", "VIN", "RESET", "AREF"].map((id2) => ({
      id: id2,
      label: id2,
      electricalType: id2 === "GND" ? "ground" : id2 === "5V" || id2 === "3V3" ? "power" : id2 === "VIN" ? "power-input" : "input",
      digital: false
    }))
  ];
}
function boardI2cPins(kind) {
  return kind === "mega2560" ? { sda: "D20", scl: "D21" } : { sda: "A4", scl: "A5" };
}
function virtualBoardPins(kind) {
  if (!isMcuKind(kind)) return [];
  return [
    { id: "DEBUG", label: "DEBUG (virtual)", electricalType: "virtual-debug" },
    ...kind === "yd-esp32-s3" ? [
      {
        id: "CONSOLE",
        label: "CONSOLE (virtual guest)",
        electricalType: "virtual-console"
      }
    ] : []
  ];
}

// ../simulab-frontend/src/models/dcSolver.ts
function solveDc(nodes, drivers, branches, limit = 256) {
  const volts = Object.fromEntries(
    nodes.map((n) => [n, null])
  ), currents = {}, issues = [];
  const edges = new Map(nodes.map((n) => [n, []]));
  for (const b of branches) {
    currents[b.id] = null;
    if (!Number.isFinite(b.ohms) || b.ohms < 1e-6 || b.ohms > 1e12) {
      issues.push(`Invalid resistance ${b.id}`);
      continue;
    }
    edges.get(b.a)?.push(b);
    edges.get(b.b)?.push(b);
  }
  const seen = /* @__PURE__ */ new Set();
  for (const seed of nodes) {
    if (seen.has(seed)) continue;
    const island = [], pending = [seed];
    while (pending.length) {
      const n = pending.pop();
      if (seen.has(n)) continue;
      seen.add(n);
      island.push(n);
      for (const b of edges.get(n) ?? []) pending.push(b.a === n ? b.b : b.a);
    }
    const fixed = /* @__PURE__ */ new Map();
    let conflict = false;
    for (const n of island) {
      const ds = drivers[n] ?? [];
      if (ds.length) {
        if (ds.some((v) => !Number.isFinite(v) || Math.abs(v - ds[0]) > 0.1))
          conflict = true;
        else fixed.set(n, ds[0]);
      }
    }
    if (conflict) {
      issues.push("Conflicting ideal voltage sources in resistive island");
      continue;
    }
    if (!fixed.size) continue;
    const unknown = island.filter((n) => !fixed.has(n));
    if (unknown.length > limit) {
      issues.push(`DC solver island exceeds ${limit} unknown nodes`);
      continue;
    }
    const index = new Map(unknown.map((n, i) => [n, i])), a = unknown.map(() => new Float64Array(unknown.length + 1));
    for (const n of unknown) {
      const row = a[index.get(n)];
      for (const b of edges.get(n) ?? []) {
        const other = b.a === n ? b.b : b.a;
        if (other === n) continue;
        const g = 1 / b.ohms;
        row[index.get(n)] += g;
        if (fixed.has(other)) row[unknown.length] += g * fixed.get(other);
        else row[index.get(other)] -= g;
      }
    }
    let singular = false;
    for (let i = 0; i < unknown.length; i++) {
      let pivot = i;
      for (let j = i + 1; j < unknown.length; j++)
        if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
      if (Math.abs(a[pivot][i]) < 1e-15) {
        singular = true;
        break;
      }
      [a[i], a[pivot]] = [a[pivot], a[i]];
      const d = a[i][i];
      for (let k = i; k <= unknown.length; k++) a[i][k] /= d;
      for (let j = 0; j < unknown.length; j++) {
        if (j === i) continue;
        const f = a[j][i];
        for (let k = i; k <= unknown.length; k++) a[j][k] -= f * a[i][k];
      }
    }
    if (singular) {
      issues.push("Singular DC island");
      continue;
    }
    for (const [n, v] of fixed) volts[n] = v;
    for (const [n, i] of index) volts[n] = a[i][unknown.length];
  }
  for (const b of branches)
    if (volts[b.a] != null && volts[b.b] != null && Number.isFinite(b.ohms) && b.ohms >= 1e-6 && b.ohms <= 1e12)
      currents[b.id] = (volts[b.a] - volts[b.b]) / b.ohms;
  return { volts, currents, issues };
}

// ../simulab-frontend/src/models/contract.ts
function checkTime(next, previous) {
  if (!Number.isFinite(next) || next < previous || next < 0)
    throw new Error("Simulation time must be finite and monotonic");
}
function bounded(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max)
    throw new Error(`${name} must be ${min}..${max}`);
  return value;
}

// ../simulab-frontend/src/models/robotics.ts
var modelState = () => ({
  values: {},
  outputs: {},
  contacts: [],
  warnings: []
});
function supply(p, rail = "VCC", min = 3, max = 6) {
  const v = p[rail], g = p.GND;
  return typeof v === "number" && typeof g === "number" && v - g >= min && v - g <= max;
}
function logic(p, pin2) {
  const v = p[pin2], g = p.GND;
  if (typeof v !== "number" || typeof g !== "number") return null;
  const r = v - g;
  return r >= 0 && r <= 0.8 ? 0 : r >= 2 && r <= 5.5 ? 1 : null;
}
var clamp = (n, a, b) => Math.max(a, Math.min(b, n));
var StepperDriver = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.stepsPerTurn, 1, 1e4, "Steps per turn");
    bounded(profile.maxStepHz, 1, 1e5, "Step frequency");
  }
  profile;
  time = 0;
  last = null;
  edge = -Infinity;
  steps = 0;
  update(t, p) {
    checkTime(t, this.time);
    this.time = t;
    const s = modelState(), step = logic(p, "STEP"), dir = logic(p, "DIR"), enabled = supply(p) && supply(p, "VM", 2, 48) && logic(p, "EN") === 0;
    if (enabled && step === 1 && this.last === 0 && dir !== null) {
      if (t - this.edge >= 1e6 / this.profile.maxStepHz) {
        this.steps += dir ? 1 : -1;
        this.edge = t;
      } else s.warnings.push("Step rate exceeds configured driver limit");
    }
    this.last = step;
    const sequence = [
      [1, 0, 0, 0],
      [0, 0, 1, 0],
      [0, 1, 0, 0],
      [0, 0, 0, 1]
    ], phase = sequence[(this.steps % 4 + 4) % 4];
    ["A1", "A2", "B1", "B2"].forEach(
      (pin2, i) => s.outputs[pin2] = enabled ? phase[i] ? p.VM : p.GND : null
    );
    s.values = {
      enabled,
      steps: this.steps,
      angleDeg: this.steps * 360 / this.profile.stepsPerTurn
    };
    if (!enabled)
      s.warnings.push(
        "Driver disabled or missing valid VCC/VM/GND and active-low EN"
      );
    return s;
  }
};
var StepperMotor = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.stepsPerTurn, 1, 1e4, "Steps per turn");
  }
  profile;
  time = 0;
  phase = null;
  steps = 0;
  update(t, p) {
    checkTime(t, this.time);
    this.time = t;
    const s = modelState(), vs = ["A1", "A2", "B1", "B2"].map((k) => p[k]);
    let phase = null;
    if (vs.every((v) => typeof v === "number" && v >= 0 && v <= 48)) {
      const [a, b, c, d] = vs;
      const x = a - b, y = c - d;
      if (Math.abs(x) >= 1 && Math.abs(y) < 0.1) phase = x > 0 ? 0 : 2;
      if (Math.abs(y) >= 1 && Math.abs(x) < 0.1) phase = y > 0 ? 1 : 3;
    }
    if (phase !== null && this.phase !== null && phase !== this.phase) {
      const delta = (phase - this.phase + 4) % 4;
      if (delta === 1) this.steps++;
      else if (delta === 3) this.steps--;
      else s.warnings.push("Skipped/invalid full-step sequence");
    }
    this.phase = phase;
    s.values = {
      steps: this.steps,
      angleDeg: this.steps * 360 / this.profile.stepsPerTurn,
      powered: phase !== null
    };
    if (phase === null)
      s.warnings.push("No valid powered full-step coil sequence");
    return s;
  }
};
var Servo = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.minAngle, -360, 360, "Minimum angle");
    bounded(profile.maxAngle, profile.minAngle, 360, "Maximum angle");
    bounded(profile.speedDegS, 0.01, 2e3, "Servo speed");
    this.angle = this.target = clamp(0, profile.minAngle, profile.maxAngle);
  }
  profile;
  time = 0;
  rising = null;
  previous = null;
  target = 0;
  angle = 0;
  frames = 0;
  update(t, p) {
    checkTime(t, this.time);
    const dt = (t - this.time) / 1e6;
    this.time = t;
    const s = modelState(), powered = supply(p, "VCC", 4.5, 6), input = logic(p, "PWM");
    if (powered) {
      this.angle += clamp(
        this.target - this.angle,
        -this.profile.speedDegS * dt,
        this.profile.speedDegS * dt
      );
      if (input === 1 && this.previous !== 1) this.rising = t;
      if (input === 0 && this.previous === 1 && this.rising !== null) {
        const width = t - this.rising;
        if (width >= 1e3 && width <= 2e3) {
          this.target = this.profile.minAngle + (width - 1e3) / 1e3 * (this.profile.maxAngle - this.profile.minAngle);
          this.frames++;
        } else s.warnings.push("Invalid servo pulse: expected 1000..2000 us");
        this.rising = null;
      }
    } else {
      this.rising = null;
      s.warnings.push("Servo requires 4.5..6 V power and ground");
    }
    this.previous = input;
    s.values = {
      powered,
      angleDeg: this.angle,
      targetDeg: this.target,
      frames: this.frames
    };
    return s;
  }
};
var armProfiles = {
  "arm-6dof": {
    joints: 6,
    limits: [
      [-180, 180],
      [-90, 90],
      [-135, 135],
      [-180, 180],
      [-120, 120],
      [-180, 180]
    ],
    link1Mm: 200,
    link2Mm: 160
  },
  "universal-arm": {
    joints: 6,
    limits: [
      [-180, 180],
      [-180, 180],
      [-180, 180],
      [-180, 180],
      [-180, 180],
      [-180, 180]
    ],
    link1Mm: 250,
    link2Mm: 220
  },
  "dobot-magician": {
    joints: 4,
    limits: [
      [-135, 135],
      [-5, 85],
      [-10, 95],
      [-90, 90]
    ],
    link1Mm: 135,
    link2Mm: 147
  },
  "uarm-metal": {
    joints: 4,
    limits: [
      [-90, 90],
      [0, 90],
      [-90, 90],
      [-90, 90]
    ],
    link1Mm: 148,
    link2Mm: 160
  }
};
function armKinematics(joints, link1Mm, link2Mm) {
  const r = Math.PI / 180, yaw = (joints[0] ?? 0) * r, a = (joints[1] ?? 0) * r, b = a + (joints[2] ?? 0) * r, reach = link1Mm * Math.cos(a) + link2Mm * Math.cos(b);
  return {
    toolX: reach * Math.cos(yaw),
    toolY: reach * Math.sin(yaw),
    toolZ: 80 + link1Mm * Math.sin(a) + link2Mm * Math.sin(b),
    yawDeg: (joints[0] ?? 0) + (joints[5] ?? 0),
    pitchDeg: (joints[1] ?? 0) + (joints[2] ?? 0) + (joints[4] ?? 0),
    rollDeg: joints[3] ?? 0
  };
}
var RobotArm = class {
  constructor(profile) {
    this.profile = profile;
    this.geometry = armProfiles[profile.profile];
    if (!this.geometry) throw new Error("Unknown arm profile");
    bounded(profile.link1Mm, 1, 5e3, "Link 1");
    bounded(profile.link2Mm, 1, 5e3, "Link 2");
    this.servos = this.geometry.limits.map(
      ([minAngle, maxAngle]) => new Servo({ minAngle, maxAngle, speedDegS: profile.speedDegS })
    );
  }
  profile;
  servos;
  geometry;
  update(t, p) {
    const s = modelState(), joints = this.servos.map((servo, i) => {
      const state = servo.update(t, { ...p, PWM: p[`J${i + 1}`] });
      s.values[`joint${i + 1}Deg`] = state.values.angleDeg;
      s.values[`target${i + 1}Deg`] = state.values.targetDeg;
      for (const w of state.warnings) s.warnings.push(`J${i + 1}: ${w}`);
      return Number(state.values.angleDeg);
    });
    s.values = {
      ...s.values,
      ...armKinematics(joints, this.profile.link1Mm, this.profile.link2Mm),
      powered: supply(p, "VCC", 4.5, 6),
      profile: this.profile.profile,
      joints: this.geometry.joints
    };
    s.warnings.push(
      "Approximate educational profile; configurable geometry and limits; no vendor USB/serial or collision dynamics"
    );
    return s;
  }
};
var MotionAssembly = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.speed, 1e-3, 20, "Assembly speed");
    bounded(profile.trackM, 0.01, 10, "Wheel track");
  }
  profile;
  time = 0;
  x = 0;
  y = 0;
  heading = 0;
  distance = 0;
  update(t, p) {
    checkTime(t, this.time);
    const dt = (t - this.time) / 1e6;
    this.time = t;
    const s = modelState(), enabled = supply(p) && supply(p, "VM", 3, 48) && logic(p, "EN") === 1;
    const direction = (a, b) => {
      const x = logic(p, a), y = logic(p, b);
      return x === null || y === null ? 0 : x - y;
    };
    const l = enabled ? direction("IN1", "IN2") * this.profile.speed : 0, r = this.profile.type === "car" ? enabled ? direction("IN3", "IN4") * this.profile.speed : 0 : l, speed = (l + r) / 2, omega = (r - l) / this.profile.trackM;
    const h = this.heading;
    if (Math.abs(omega) > 1e-9) {
      this.x += speed / omega * (Math.sin(h + omega * dt) - Math.sin(h));
      this.y -= speed / omega * (Math.cos(h + omega * dt) - Math.cos(h));
    } else {
      this.x += speed * Math.cos(h) * dt;
      this.y += speed * Math.sin(h) * dt;
    }
    this.heading += omega * dt;
    this.distance += speed * dt;
    s.values = {
      enabled,
      speedMps: speed,
      leftMps: l,
      rightMps: r,
      distanceM: this.distance,
      xM: this.x,
      yM: this.y,
      headingRad: this.heading
    };
    if (!enabled)
      s.warnings.push("Assembly requires VM, VCC, GND and valid EN");
    s.warnings.push(
      "Ideal no-slip educational mechanics; no load, collision or traction dynamics"
    );
    return s;
  }
};
var OpticalChannel = class {
  emitters = /* @__PURE__ */ new Map();
  emit(id2, channel, on, x, y, range) {
    this.emitters.set(id2, { channel, on, x, y, range });
  }
  detect(channel, x, y, blocked) {
    return !blocked && [...this.emitters.values()].some(
      (e) => e.channel === channel && e.on && Math.hypot(e.x - x, e.y - y) <= e.range
    );
  }
};
var IrModule = class {
  constructor(config, optical) {
    this.config = config;
    this.optical = optical;
    bounded(config.x, -1e4, 1e4, "Optical x");
    bounded(config.y, -1e4, 1e4, "Optical y");
    bounded(config.range, 1e-3, 1e4, "Optical range");
  }
  config;
  optical;
  time = 0;
  update(t, p) {
    checkTime(t, this.time);
    this.time = t;
    const s = modelState(), powered = supply(p);
    if (this.config.emitter) {
      const on = powered && logic(p, "IN") === 1;
      this.optical.emit(
        this.config.id,
        this.config.channel,
        on,
        this.config.x,
        this.config.y,
        this.config.range
      );
      s.values = { powered, emitting: on, channel: this.config.channel };
    } else {
      const detected = powered && this.optical.detect(
        this.config.channel,
        this.config.x,
        this.config.y,
        this.config.blocked
      );
      s.outputs.OUT = powered ? detected ? p.GND : p.VCC : null;
      s.values = { powered, detected, channel: this.config.channel };
    }
    if (!powered) s.warnings.push("IR module requires VCC and ground");
    return s;
  }
};
var ElectromagneticSwitch = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.ratedVoltage, 1, 48, "Coil voltage");
    bounded(profile.resistanceOhms, 1, 1e5, "Coil resistance");
    bounded(profile.delayUs, 0, 1e6, "Coil delay");
  }
  profile;
  time = 0;
  since = 0;
  requested = false;
  active = false;
  update(t, p) {
    checkTime(t, this.time);
    this.time = t;
    const s = modelState(), v = typeof p.COIL_POS === "number" && typeof p.COIL_NEG === "number" ? Math.abs(p.COIL_POS - p.COIL_NEG) : 0, requested = v >= this.profile.ratedVoltage * 0.8 && v <= this.profile.ratedVoltage * 1.2;
    if (requested !== this.requested) {
      this.requested = requested;
      this.since = t;
    }
    if (t - this.since >= this.profile.delayUs) this.active = requested;
    s.contacts = [["COM", this.active ? "NO" : "NC"]];
    s.values = {
      energized: this.active,
      coilCurrentA: v / this.profile.resistanceOhms
    };
    if (v > this.profile.ratedVoltage * 1.2)
      s.warnings.push("Coil overvoltage; deenergization requested");
    return s;
  }
};

// ../simulab-frontend/src/models/parameters.ts
var parameterBounds = {
  rangeV: [1e-3, 1e4],
  rangeA: [1e-6, 1e4],
  shuntOhms: [1e-6, 1e6],
  rawValue: [-8388608, 8388607],
  rawValueB: [-8388608, 8388607],
  temperatureC: [-40, 80],
  humidityPct: [0, 100],
  stepsPerTurn: [1, 1e4],
  maxStepHz: [1, 1e5],
  minAngle: [-360, 360],
  maxAngle: [-360, 360],
  speedDegS: [0.01, 2e3],
  ratedVoltage: [1, 48],
  resistanceOhms: [1, 1e5],
  delayUs: [0, 1e6],
  link1Mm: [1, 5e3],
  link2Mm: [1, 5e3],
  speedMps: [1e-3, 20],
  trackM: [0.01, 10],
  xM: [-1e4, 1e4],
  yM: [-1e4, 1e4],
  rangeM: [1e-3, 1e4]
};
var kinds = [
  "voltmeter",
  "ammeter",
  "hx711",
  "dht22",
  "stepper",
  "stepper-driver",
  "servo",
  "electromagnetic-switch",
  "arm-6dof",
  "universal-arm",
  "dobot-magician",
  "uarm-metal",
  "conveyor",
  "robotic-car",
  "ir-emitter",
  "ir-detector"
];
function validateModelProperties(kind, properties) {
  if (!kinds.includes(kind)) return;
  for (const [key, value] of Object.entries(properties)) {
    const range = parameterBounds[key];
    if (range && (typeof value !== "number" || !Number.isFinite(value) || value < range[0] || value > range[1]))
      throw new Error(`${key} must be ${range[0]}..${range[1]}`);
    if (key === "rateHz" && value !== 10 && value !== 80)
      throw new Error("rateHz must be 10 or 80");
    if (["blocked", "pressed"].includes(key) && typeof value !== "boolean")
      throw new Error(`${key} must be boolean`);
    if (key === "channel" && (typeof value !== "string" || !value.length || value.length > 100))
      throw new Error("channel must be 1..100 characters");
  }
  if (kind === "servo" && Number(properties.minAngle ?? -90) > Number(properties.maxAngle ?? 90))
    throw new Error("Minimum angle must not exceed maximum angle");
}

// ../simulab-frontend/src/models/expandedDefinitions.ts
var pins = (names) => names.map((id2) => ({
  id: id2,
  label: id2,
  electricalType: ["VCC", "VM"].includes(id2) ? "power-input" : id2 === "GND" ? "ground-input" : "bidirectional"
}));
var define = (name, description, ids, defaultProperties) => ({
  name,
  description,
  pins: pins(ids),
  defaultProperties
});
var expandedDefinitions = {
  voltmeter: define(
    "DC voltmeter",
    "Ideal high-impedance differential probe; floating/conflict states explicit",
    ["POS", "NEG"],
    { rangeV: 60 }
  ),
  ammeter: define(
    "DC ammeter",
    "Series shunt branch in bounded linear DC resistor solver; current positive POS to NEG",
    ["POS", "NEG"],
    { shuntOhms: 0.1, rangeA: 10 }
  ),
  hx711: define(
    "HX711 load-cell amplifier",
    "Clocked 24-bit signed samples with gain/channel selection; ideal scene stimulus",
    ["VCC", "GND", "SCK", "DOUT"],
    { rawValue: 1e5, rawValueB: 0, rateHz: 10 }
  ),
  dht22: define(
    "DHT22 temperature / humidity",
    "Timed open-drain 40-bit frames; requires DATA pull-up; minimum 2 s read interval",
    ["VCC", "GND", "DATA"],
    { temperatureC: 24, humidityPct: 50 }
  ),
  stepper: define(
    "Full-step stepper motor",
    "Four-terminal winding sequence; requires powered stepper driver",
    ["A1", "A2", "B1", "B2"],
    { stepsPerTurn: 200 }
  ),
  "stepper-driver": define(
    "STEP/DIR stepper driver",
    "Integrated safe powered driver; active-low enable; ideal full-step coils",
    ["VCC", "VM", "GND", "STEP", "DIR", "EN", "A1", "A2", "B1", "B2"],
    { stepsPerTurn: 200, maxStepHz: 1e4 }
  ),
  servo: define(
    "PWM servo",
    "Powered integrated hobby servo; actual 1000..2000 us pulses command bounded angle",
    ["VCC", "GND", "PWM"],
    { minAngle: -90, maxAngle: 90, speedDegS: 180 }
  ),
  "tactile-switch": define(
    "Tactile push switch",
    "Four leads: 1A/1B and 2A/2B are internally paired; press joins pairs",
    ["1A", "1B", "2A", "2B"],
    { pressed: false }
  ),
  "electromagnetic-switch": define(
    "Electromagnetic switch",
    "Bare powered coil distinct from isolated COM/NO/NC contacts; use external driver",
    ["COIL_POS", "COIL_NEG", "COM", "NO", "NC"],
    { ratedVoltage: 5, resistanceOhms: 70, delayUs: 1e4 }
  ),
  ...Object.fromEntries(
    Object.entries(armProfiles).map(([kind, g]) => [
      kind,
      define(
        kind === "arm-6dof" ? "Generic 6DOF arm" : kind === "universal-arm" ? "Generic Universal-style arm" : kind === "dobot-magician" ? "Dobot Magician educational profile" : "uArm Metal educational profile",
        "Approximate configurable educational kinematics with powered integrated servo drivers; no vendor USB/serial/CAD compatibility",
        [
          "VCC",
          "GND",
          ...Array.from({ length: g.joints }, (_, i) => `J${i + 1}`)
        ],
        { link1Mm: g.link1Mm, link2Mm: g.link2Mm, speedDegS: 90 }
      )
    ])
  ),
  conveyor: define(
    "Conveyor assembly",
    "Powered integrated bidirectional driver; ideal no-slip belt motion",
    ["VCC", "VM", "GND", "EN", "IN1", "IN2"],
    { speedMps: 0.2, trackM: 0.2 }
  ),
  "robotic-car": define(
    "Four-wheel robotic car",
    "Powered left/right integrated H-bridges; deterministic differential drive",
    ["VCC", "VM", "GND", "EN", "IN1", "IN2", "IN3", "IN4"],
    { speedMps: 0.5, trackM: 0.18 }
  ),
  "ir-emitter": define(
    "IR emitter module",
    "Powered switched optical source; paired channel and explicit scene geometry",
    ["VCC", "GND", "IN"],
    { channel: "beam-1", xM: 0, yM: 0, rangeM: 1 }
  ),
  "ir-detector": define(
    "IR detector module",
    "Powered active-low digital detector; matching optical channel, range and obstruction",
    ["VCC", "GND", "OUT"],
    { channel: "beam-1", xM: 0.5, yM: 0, rangeM: 1, blocked: false }
  )
};

// ../simulab-frontend/src/models/sensors.ts
var Hx711 = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.rawValue, -8388608, 8388607, "Signed sample");
    if (profile.rawValueB !== void 0)
      bounded(profile.rawValueB, -8388608, 8388607, "Channel B sample");
    if (![10, 80].includes(profile.rateHz))
      throw new Error("HX711 rate must be 10 or 80 Hz");
    this.readyAt = 1e6 / profile.rateHz;
  }
  profile;
  time = 0;
  readyAt;
  clock = 0;
  highAt = 0;
  pulses = 0;
  data = 1;
  word = 0;
  gain = 128;
  channel = "A";
  sleeping = false;
  frames = 0;
  update(t, p) {
    checkTime(t, this.time);
    this.time = t;
    const s = modelState(), powered = supply(p, "VCC", 2.6, 5.5), clock = logic(p, "SCK");
    if (!powered) {
      this.readyAt = t + 1e6 / this.profile.rateHz;
      this.pulses = 0;
      this.sleeping = false;
      this.gain = 128;
      this.channel = "A";
      this.data = 1;
      s.warnings.push("HX711 requires 2.6..5.5 V and GND");
    } else {
      if (clock === 1 && this.clock !== 1) this.highAt = t;
      if (clock === 1 && t - this.highAt > 60) {
        this.sleeping = true;
        this.pulses = 0;
        this.gain = 128;
        this.channel = "A";
        this.data = 1;
        this.readyAt = Infinity;
      }
      if (this.sleeping && clock === 0) {
        this.sleeping = false;
        this.readyAt = t + 1e6 / this.profile.rateHz;
      }
      if (!this.sleeping && t >= this.readyAt && this.pulses === 0) {
        this.data = 0;
        this.word = Math.round(
          this.channel === "B" ? this.profile.rawValueB ?? this.profile.rawValue : this.profile.rawValue
        ) * (this.channel === "A" ? this.gain / 128 : 1) & 16777215;
      }
      if (!this.sleeping && clock === 1 && this.clock === 0 && t >= this.readyAt) {
        this.pulses++;
        if (this.pulses <= 24)
          this.data = this.word >>> 24 - this.pulses & 1;
        else {
          this.data = 1;
          if (this.pulses > 27)
            s.warnings.push("HX711 invalid frame: more than 27 clocks");
        }
      }
      if (clock === 0 && this.clock === 1 && this.pulses >= 25 && this.readyAt <= t) {
        this.channel = this.pulses === 26 ? "B" : "A";
        this.gain = this.pulses === 26 ? 32 : this.pulses === 27 ? 64 : 128;
        this.readyAt = t + 1e6 / this.profile.rateHz;
        this.frames++;
      } else if (clock === 1 && this.clock === 0 && this.pulses >= 25 && this.pulses < 27 && t < this.readyAt) {
        this.pulses++;
        this.channel = this.pulses === 26 ? "B" : "A";
        this.gain = this.pulses === 26 ? 32 : 64;
      }
      if (this.pulses >= 25 && clock === 0 && t >= this.readyAt) {
        this.pulses = 0;
        this.data = 0;
      }
    }
    this.clock = clock;
    s.outputs.DOUT = powered ? this.data ? p.VCC : p.GND : null;
    s.values = {
      ready: powered && !this.sleeping && this.data === 0 && this.pulses === 0,
      powered,
      powerDown: this.sleeping,
      pulses: this.pulses,
      gain: this.gain,
      channel: this.channel,
      frames: this.frames,
      rawValue: this.profile.rawValue
    };
    s.warnings.push(
      "Ideal sample stimulus; bridge noise, calibration drift and analog conversion accuracy are not modeled"
    );
    return s;
  }
};
var Dht22 = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.temperatureC, -40, 80, "Temperature");
    bounded(profile.humidityPct, 0, 100, "Humidity");
  }
  profile;
  time = 0;
  lowAt = null;
  previous = 1;
  frameStart = null;
  end = 0;
  next = -Infinity;
  frames = 0;
  segments = [];
  update(t, p) {
    checkTime(t, this.time);
    this.time = t;
    const s = modelState(), powered = supply(p, "VCC", 3.3, 5.5), input = logic(p, "DATA");
    if (!powered) {
      this.frameStart = null;
      this.lowAt = null;
      this.segments = [];
      s.warnings.push("DHT22 requires 3.3..5.5 V and GND");
    } else if (this.frameStart !== null) {
      if (t >= this.end) {
        this.frameStart = null;
        this.frames++;
        this.previous = input;
        this.lowAt = null;
      }
    } else {
      if (input === 0 && this.previous !== 0) this.lowAt = t;
      if (input !== 0 && this.previous === 0 && this.lowAt !== null) {
        if (t - this.lowAt >= 800 && t >= this.next) {
          this.frameStart = t;
          this.next = t + 2e6;
          let at = t + 20;
          this.segments = [
            { end: at, low: false },
            { end: at += 80, low: true },
            { end: at += 80, low: false }
          ];
          const h = Math.round(this.profile.humidityPct * 10), temp = Math.round(Math.abs(this.profile.temperatureC) * 10) | (this.profile.temperatureC < 0 ? 32768 : 0), bytes = [h >> 8, h & 255, temp >> 8, temp & 255];
          bytes.push(bytes.reduce((a, b) => a + b, 0) & 255);
          for (const byte of bytes)
            for (let bit = 7; bit >= 0; bit--) {
              this.segments.push(
                { end: at += 50, low: true },
                { end: at += byte >> bit & 1 ? 70 : 28, low: false }
              );
            }
          this.segments.push({ end: at += 50, low: true });
          this.end = at;
        } else if (t < this.next)
          s.warnings.push("DHT22 read interval must be at least 2 seconds");
        this.lowAt = null;
      }
      this.previous = input;
    }
    const low = this.frameStart !== null && this.segments.find((segment) => t < segment.end)?.low === true;
    s.outputs.DATA = powered && low ? p.GND : null;
    s.values = {
      powered,
      temperatureC: this.profile.temperatureC,
      humidityPct: this.profile.humidityPct,
      busy: this.frameStart !== null,
      frames: this.frames
    };
    return s;
  }
};

// ../simulab-frontend/src/models/factory.ts
function createExpandedModel(c, optical) {
  const defaults = expandedDefinitions[c.kind];
  if (!defaults) return;
  const p = { ...defaults.defaultProperties, ...c.properties };
  validateModelProperties(c.kind, p);
  const n = (key) => Number(p[key]);
  switch (c.kind) {
    case "hx711":
      return new Hx711({
        rawValue: n("rawValue"),
        rawValueB: n("rawValueB"),
        rateHz: n("rateHz")
      });
    case "dht22":
      return new Dht22({
        temperatureC: n("temperatureC"),
        humidityPct: n("humidityPct")
      });
    case "stepper-driver":
      return new StepperDriver({
        stepsPerTurn: n("stepsPerTurn"),
        maxStepHz: n("maxStepHz")
      });
    case "stepper":
      return new StepperMotor({ stepsPerTurn: n("stepsPerTurn") });
    case "servo":
      return new Servo({
        minAngle: n("minAngle"),
        maxAngle: n("maxAngle"),
        speedDegS: n("speedDegS")
      });
    case "arm-6dof":
    case "universal-arm":
    case "dobot-magician":
    case "uarm-metal":
      return new RobotArm({
        profile: c.kind,
        link1Mm: n("link1Mm"),
        link2Mm: n("link2Mm"),
        speedDegS: n("speedDegS")
      });
    case "conveyor":
    case "robotic-car":
      return new MotionAssembly({
        type: c.kind === "conveyor" ? "conveyor" : "car",
        speed: n("speedMps"),
        trackM: n("trackM")
      });
    case "electromagnetic-switch":
      return new ElectromagneticSwitch({
        ratedVoltage: n("ratedVoltage"),
        resistanceOhms: n("resistanceOhms"),
        delayUs: n("delayUs")
      });
    case "ir-emitter":
    case "ir-detector":
      return new IrModule(
        {
          id: c.id,
          emitter: c.kind === "ir-emitter",
          channel: String(p.channel),
          x: n("xM"),
          y: n("yM"),
          range: n("rangeM"),
          blocked: p.blocked === true
        },
        optical
      );
  }
}

// ../simulab-frontend/src/boards/yd-esp32-s3.json
var yd_esp32_s3_default = {
  schemaVersion: "1.0.0",
  id: "yd-esp32-s3-2022-v1.3",
  name: "YD-ESP32-S3-2022-V1.3",
  manufacturer: "VCC-GND Studio",
  revision: "2022-V1.3",
  mcu: "ESP32-S3",
  cpu: "Dual-core Xtensa LX7",
  physicalPins: 44,
  numberingConvention: "physicalNumber is a UI ordinal: P1 top-to-bottom 1..22, P2 top-to-bottom 23..44. Manufacturer header numbers are header and headerIndex. All positions are module-side view with antenna at top and USB connectors at bottom.",
  dimensionsMm: {
    width: 27.94,
    height: 63.39
  },
  dimensionStatus: "manufacturer-drawing-verified",
  verification: {
    pinout: "manufacturer-family-verified",
    exactRevision: "requires-confirmation",
    note: "Manufacturer repository provides family header tables and V1.4 schematic, not an independently verified 2022-V1.3 schematic. Confirm the physical board revision and module marking."
  },
  memory: {
    defaultVariant: "unconfirmed",
    profiles: {
      N16R8: {
        flashMB: 16,
        psramMB: 8,
        psramMode: "octal",
        reservedGpio: [35, 36, 37],
        verification: "module-marking-required"
      }
    }
  },
  onboard: {
    rgb: {
      gpio: 48,
      type: "WS2812",
      verification: "manufacturer-family"
    },
    boot: {
      gpio: 0,
      activeLow: true
    },
    reset: {
      signal: "EN",
      activeLow: true
    },
    usb: [
      {
        type: "USB-C",
        role: "native",
        gpioDm: 19,
        gpioDp: 20
      },
      {
        type: "USB-C",
        role: "usb-to-uart",
        bridge: "CH343P",
        uartTx: 43,
        uartRx: 44
      }
    ]
  },
  internalNets: [
    {
      name: "3V3",
      pinIds: ["P1.1", "P1.2"]
    },
    {
      name: "GND",
      pinIds: ["P1.22", "P2.1", "P2.21", "P2.22"]
    }
  ],
  sources: [
    {
      url: "https://github.com/vcc-gnd/YD-ESP32-S3/blob/b4ac4d60d1845a554bbbc7c97806ccb97cf08941/README.md",
      revision: "b4ac4d60d1845a554bbbc7c97806ccb97cf08941",
      purpose: "Manufacturer family pin order, GPIO48 RGB, USB, UART, BOOT and octal-memory restrictions"
    },
    {
      url: "https://github.com/espressif/esp-idf/blob/v5.4.2/components/soc/esp32s3/include/soc/soc_caps.h",
      revision: "v5.4.2",
      purpose: "All valid ESP32-S3 GPIO including46 are output-capable; do not copy classic ESP32 input-only restrictions"
    },
    {
      url: "https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html",
      revision: "ESP-IDF stable accessed2026-11-05",
      purpose: "GPIO matrix, strapping and flash/PSRAM restrictions"
    },
    {
      url: "https://github.com/vcc-gnd/YD-ESP32-S3/blob/b4ac4d60d1845a554bbbc7c97806ccb97cf08941/5-public-YD-ESP32-S3-Hardware%20info/ESP32-S3-Metric.pdf",
      revision: "b4ac4d60d1845a554bbbc7c97806ccb97cf08941",
      purpose: "Manufacturer metric drawing: width27.94mm, overall height63.39mm, PCB57.15mm, header pitch2.54mm, rows53.34mm, columns25.40mm. Family reference; exactV1.3 remains unconfirmed."
    }
  ],
  pins: [
    {
      id: "P1.1",
      physicalNumber: 1,
      header: "P1",
      headerIndex: 1,
      side: "left",
      label: "3V3",
      gpio: null,
      arduinoPin: null,
      electricalType: "power",
      functions: ["3V3"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    },
    {
      id: "P1.2",
      physicalNumber: 2,
      header: "P1",
      headerIndex: 2,
      side: "left",
      label: "3V3",
      gpio: null,
      arduinoPin: null,
      electricalType: "power",
      functions: ["3V3"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    },
    {
      id: "P1.3",
      physicalNumber: 3,
      header: "P1",
      headerIndex: 3,
      side: "left",
      label: "RST",
      gpio: null,
      arduinoPin: null,
      electricalType: "input",
      functions: ["EN"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    },
    {
      id: "P1.4",
      physicalNumber: 4,
      header: "P1",
      headerIndex: 4,
      side: "left",
      label: "4",
      gpio: 4,
      arduinoPin: 4,
      electricalType: "bidirectional",
      functions: [
        "GPIO4",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO4",
        "TOUCH4",
        "ADC1_CH3"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 3
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.5",
      physicalNumber: 5,
      header: "P1",
      headerIndex: 5,
      side: "left",
      label: "5",
      gpio: 5,
      arduinoPin: 5,
      electricalType: "bidirectional",
      functions: [
        "GPIO5",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO5",
        "TOUCH5",
        "ADC1_CH4"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 4
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.6",
      physicalNumber: 6,
      header: "P1",
      headerIndex: 6,
      side: "left",
      label: "6",
      gpio: 6,
      arduinoPin: 6,
      electricalType: "bidirectional",
      functions: [
        "GPIO6",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO6",
        "TOUCH6",
        "ADC1_CH5"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 5
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.7",
      physicalNumber: 7,
      header: "P1",
      headerIndex: 7,
      side: "left",
      label: "7",
      gpio: 7,
      arduinoPin: 7,
      electricalType: "bidirectional",
      functions: [
        "GPIO7",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO7",
        "TOUCH7",
        "ADC1_CH6"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 6
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.8",
      physicalNumber: 8,
      header: "P1",
      headerIndex: 8,
      side: "left",
      label: "15",
      gpio: 15,
      arduinoPin: 15,
      electricalType: "bidirectional",
      functions: [
        "GPIO15",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO15",
        "ADC2_CH4",
        "U0RTS",
        "XTAL_32K_P"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 4
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.9",
      physicalNumber: 9,
      header: "P1",
      headerIndex: 9,
      side: "left",
      label: "16",
      gpio: 16,
      arduinoPin: 16,
      electricalType: "bidirectional",
      functions: [
        "GPIO16",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO16",
        "ADC2_CH5",
        "U0CTS",
        "XTAL_32K_N"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 5
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.10",
      physicalNumber: 10,
      header: "P1",
      headerIndex: 10,
      side: "left",
      label: "17",
      gpio: 17,
      arduinoPin: 17,
      electricalType: "bidirectional",
      functions: [
        "GPIO17",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO17",
        "ADC2_CH6",
        "U1TXD"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 6
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.11",
      physicalNumber: 11,
      header: "P1",
      headerIndex: 11,
      side: "left",
      label: "18",
      gpio: 18,
      arduinoPin: 18,
      electricalType: "bidirectional",
      functions: [
        "GPIO18",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO18",
        "ADC2_CH7",
        "U1RXD",
        "CLK_OUT3"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 7
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.12",
      physicalNumber: 12,
      header: "P1",
      headerIndex: 12,
      side: "left",
      label: "8",
      gpio: 8,
      arduinoPin: 8,
      electricalType: "bidirectional",
      functions: [
        "GPIO8",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO8",
        "TOUCH8",
        "ADC1_CH7",
        "SUBSPICS1"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 7
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.13",
      physicalNumber: 13,
      header: "P1",
      headerIndex: 13,
      side: "left",
      label: "3",
      gpio: 3,
      arduinoPin: 3,
      electricalType: "bidirectional",
      functions: [
        "GPIO3",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO3",
        "TOUCH3",
        "ADC1_CH2"
      ],
      restrictions: ["strapping"],
      adc: {
        unit: 1,
        channel: 2
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.14",
      physicalNumber: 14,
      header: "P1",
      headerIndex: 14,
      side: "left",
      label: "46",
      gpio: 46,
      arduinoPin: 46,
      electricalType: "bidirectional",
      functions: [
        "GPIO46",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC"
      ],
      restrictions: ["strapping"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.15",
      physicalNumber: 15,
      header: "P1",
      headerIndex: 15,
      side: "left",
      label: "9",
      gpio: 9,
      arduinoPin: 9,
      electricalType: "bidirectional",
      functions: [
        "GPIO9",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO9",
        "TOUCH9",
        "ADC1_CH8",
        "FSPIHD",
        "SUBSPIHD"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 8
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.16",
      physicalNumber: 16,
      header: "P1",
      headerIndex: 16,
      side: "left",
      label: "10",
      gpio: 10,
      arduinoPin: 10,
      electricalType: "bidirectional",
      functions: [
        "GPIO10",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO10",
        "TOUCH10",
        "ADC1_CH9",
        "FSPICS0",
        "FSPIIO4",
        "SUBSPICS0"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 9
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.17",
      physicalNumber: 17,
      header: "P1",
      headerIndex: 17,
      side: "left",
      label: "11",
      gpio: 11,
      arduinoPin: 11,
      electricalType: "bidirectional",
      functions: [
        "GPIO11",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO11",
        "TOUCH11",
        "ADC2_CH0",
        "FSPID",
        "FSPIIO5",
        "SUBSPID"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 0
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.18",
      physicalNumber: 18,
      header: "P1",
      headerIndex: 18,
      side: "left",
      label: "12",
      gpio: 12,
      arduinoPin: 12,
      electricalType: "bidirectional",
      functions: [
        "GPIO12",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO12",
        "TOUCH12",
        "ADC2_CH1",
        "FSPICLK",
        "FSPIIO6",
        "SUBSPICLK"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 1
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.19",
      physicalNumber: 19,
      header: "P1",
      headerIndex: 19,
      side: "left",
      label: "13",
      gpio: 13,
      arduinoPin: 13,
      electricalType: "bidirectional",
      functions: [
        "GPIO13",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO13",
        "TOUCH13",
        "ADC2_CH2",
        "FSPIQ",
        "FSPIIO7",
        "SUBSPIQ"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 2
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.20",
      physicalNumber: 20,
      header: "P1",
      headerIndex: 20,
      side: "left",
      label: "14",
      gpio: 14,
      arduinoPin: 14,
      electricalType: "bidirectional",
      functions: [
        "GPIO14",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO14",
        "TOUCH14",
        "ADC2_CH3",
        "FSPIWP",
        "FSPIDQS",
        "SUBSPIWP"
      ],
      restrictions: [],
      adc: {
        unit: 2,
        channel: 3
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P1.21",
      physicalNumber: 21,
      header: "P1",
      headerIndex: 21,
      side: "left",
      label: "5V",
      gpio: null,
      arduinoPin: null,
      electricalType: "power",
      functions: ["5V"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    },
    {
      id: "P1.22",
      physicalNumber: 22,
      header: "P1",
      headerIndex: 22,
      side: "left",
      label: "G",
      gpio: null,
      arduinoPin: null,
      electricalType: "ground",
      functions: ["GND"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    },
    {
      id: "P2.1",
      physicalNumber: 23,
      header: "P2",
      headerIndex: 1,
      side: "right",
      label: "G",
      gpio: null,
      arduinoPin: null,
      electricalType: "ground",
      functions: ["GND"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    },
    {
      id: "P2.2",
      physicalNumber: 24,
      header: "P2",
      headerIndex: 2,
      side: "right",
      label: "TX",
      gpio: 43,
      arduinoPin: 43,
      electricalType: "bidirectional",
      functions: [
        "GPIO43",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "U0TXD",
        "CLK_OUT1"
      ],
      restrictions: ["uart0-bridge-shared"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.3",
      physicalNumber: 25,
      header: "P2",
      headerIndex: 3,
      side: "right",
      label: "RX",
      gpio: 44,
      arduinoPin: 44,
      electricalType: "bidirectional",
      functions: [
        "GPIO44",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "U0RXD",
        "CLK_OUT2"
      ],
      restrictions: ["uart0-bridge-shared"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.4",
      physicalNumber: 26,
      header: "P2",
      headerIndex: 4,
      side: "right",
      label: "1",
      gpio: 1,
      arduinoPin: 1,
      electricalType: "bidirectional",
      functions: [
        "GPIO1",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO1",
        "TOUCH1",
        "ADC1_CH0"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 0
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.5",
      physicalNumber: 27,
      header: "P2",
      headerIndex: 5,
      side: "right",
      label: "2",
      gpio: 2,
      arduinoPin: 2,
      electricalType: "bidirectional",
      functions: [
        "GPIO2",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO2",
        "TOUCH2",
        "ADC1_CH1"
      ],
      restrictions: [],
      adc: {
        unit: 1,
        channel: 1
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.6",
      physicalNumber: 28,
      header: "P2",
      headerIndex: 6,
      side: "right",
      label: "42",
      gpio: 42,
      arduinoPin: 42,
      electricalType: "bidirectional",
      functions: [
        "GPIO42",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "MTMS"
      ],
      restrictions: ["jtag-shared"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.7",
      physicalNumber: 29,
      header: "P2",
      headerIndex: 7,
      side: "right",
      label: "41",
      gpio: 41,
      arduinoPin: 41,
      electricalType: "bidirectional",
      functions: [
        "GPIO41",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "MTDI",
        "CLK_OUT1"
      ],
      restrictions: ["jtag-shared"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.8",
      physicalNumber: 30,
      header: "P2",
      headerIndex: 8,
      side: "right",
      label: "40",
      gpio: 40,
      arduinoPin: 40,
      electricalType: "bidirectional",
      functions: [
        "GPIO40",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "MTDO",
        "CLK_OUT2"
      ],
      restrictions: ["jtag-shared"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.9",
      physicalNumber: 31,
      header: "P2",
      headerIndex: 9,
      side: "right",
      label: "39",
      gpio: 39,
      arduinoPin: 39,
      electricalType: "bidirectional",
      functions: [
        "GPIO39",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "MTCK",
        "CLK_OUT3",
        "SUBSPICS1"
      ],
      restrictions: ["jtag-shared"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.10",
      physicalNumber: 32,
      header: "P2",
      headerIndex: 10,
      side: "right",
      label: "38",
      gpio: 38,
      arduinoPin: 38,
      electricalType: "bidirectional",
      functions: [
        "GPIO38",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "FSPIWP",
        "SUBSPIWP"
      ],
      restrictions: [],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.11",
      physicalNumber: 33,
      header: "P2",
      headerIndex: 11,
      side: "right",
      label: "37",
      gpio: 37,
      arduinoPin: 37,
      electricalType: "bidirectional",
      functions: [
        "GPIO37",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "SPIDQS",
        "FSPIQ",
        "SUBSPIQ"
      ],
      restrictions: ["reserved-on-octal-memory-variants"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.12",
      physicalNumber: 34,
      header: "P2",
      headerIndex: 12,
      side: "right",
      label: "36",
      gpio: 36,
      arduinoPin: 36,
      electricalType: "bidirectional",
      functions: [
        "GPIO36",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "SPIIO7",
        "FSPICLK",
        "SUBSPICLK"
      ],
      restrictions: ["reserved-on-octal-memory-variants"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.13",
      physicalNumber: 35,
      header: "P2",
      headerIndex: 13,
      side: "right",
      label: "35",
      gpio: 35,
      arduinoPin: 35,
      electricalType: "bidirectional",
      functions: [
        "GPIO35",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "SPIIO6",
        "FSPID",
        "SUBSPID"
      ],
      restrictions: ["reserved-on-octal-memory-variants"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.14",
      physicalNumber: 36,
      header: "P2",
      headerIndex: 14,
      side: "right",
      label: "0",
      gpio: 0,
      arduinoPin: 0,
      electricalType: "bidirectional",
      functions: [
        "GPIO0",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO0"
      ],
      restrictions: ["strapping"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.15",
      physicalNumber: 37,
      header: "P2",
      headerIndex: 15,
      side: "right",
      label: "45",
      gpio: 45,
      arduinoPin: 45,
      electricalType: "bidirectional",
      functions: [
        "GPIO45",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC"
      ],
      restrictions: ["strapping"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.16",
      physicalNumber: 38,
      header: "P2",
      headerIndex: 16,
      side: "right",
      label: "48",
      gpio: 48,
      arduinoPin: 48,
      electricalType: "bidirectional",
      functions: [
        "GPIO48",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "SPICLK_N",
        "SUBSPICLK_N_DIFF",
        "WS2812_DATA"
      ],
      restrictions: ["onboard-ws2812-shared", "check-module-voltage-variant"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.17",
      physicalNumber: 39,
      header: "P2",
      headerIndex: 17,
      side: "right",
      label: "47",
      gpio: 47,
      arduinoPin: 47,
      electricalType: "bidirectional",
      functions: [
        "GPIO47",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "SPICLK_P",
        "SUBSPICLK_P_DIFF"
      ],
      restrictions: ["check-module-voltage-variant"],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.18",
      physicalNumber: 40,
      header: "P2",
      headerIndex: 18,
      side: "right",
      label: "21",
      gpio: 21,
      arduinoPin: 21,
      electricalType: "bidirectional",
      functions: [
        "GPIO21",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO21"
      ],
      restrictions: [],
      adc: null,
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.19",
      physicalNumber: 41,
      header: "P2",
      headerIndex: 19,
      side: "right",
      label: "20",
      gpio: 20,
      arduinoPin: 20,
      electricalType: "bidirectional",
      functions: [
        "GPIO20",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO20",
        "ADC2_CH9",
        "U1CTS",
        "CLK_OUT1",
        "USB_D+"
      ],
      restrictions: ["native-usb-shared"],
      adc: {
        unit: 2,
        channel: 9
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.20",
      physicalNumber: 42,
      header: "P2",
      headerIndex: 20,
      side: "right",
      label: "19",
      gpio: 19,
      arduinoPin: 19,
      electricalType: "bidirectional",
      functions: [
        "GPIO19",
        "GPIO_MATRIX_UART",
        "GPIO_MATRIX_I2C",
        "GPIO_MATRIX_SPI",
        "LEDC",
        "RTC_GPIO19",
        "ADC2_CH8",
        "U1RTS",
        "CLK_OUT2",
        "USB_D-"
      ],
      restrictions: ["native-usb-shared"],
      adc: {
        unit: 2,
        channel: 8
      },
      ledc: true,
      i2c: true,
      spi: true,
      uart: {
        tx: true,
        rx: true
      }
    },
    {
      id: "P2.21",
      physicalNumber: 43,
      header: "P2",
      headerIndex: 21,
      side: "right",
      label: "G",
      gpio: null,
      arduinoPin: null,
      electricalType: "ground",
      functions: ["GND"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    },
    {
      id: "P2.22",
      physicalNumber: 44,
      header: "P2",
      headerIndex: 22,
      side: "right",
      label: "G",
      gpio: null,
      arduinoPin: null,
      electricalType: "ground",
      functions: ["GND"],
      restrictions: [],
      adc: null,
      ledc: false,
      i2c: false,
      spi: false,
      uart: {
        tx: false,
        rx: false
      }
    }
  ]
};

// ../simulab-frontend/src/boards/yd-esp32-s3.ts
var leftGPIO = [
  null,
  null,
  null,
  4,
  5,
  6,
  7,
  15,
  16,
  17,
  18,
  8,
  3,
  46,
  9,
  10,
  11,
  12,
  13,
  14,
  null,
  null
];
var rightGPIO = [
  null,
  43,
  44,
  1,
  2,
  42,
  41,
  40,
  39,
  38,
  37,
  36,
  35,
  0,
  45,
  48,
  47,
  21,
  20,
  19,
  null,
  null
];
var invalid = (message) => {
  throw new Error(`Invalid YD board definition: ${message}`);
};
var record = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : invalid("expected object");
var text = (v, max = 1500) => typeof v === "string" && v.length > 0 && v.length <= max ? v : invalid("invalid text");
var strings = (v) => Array.isArray(v) && v.length <= 40 && v.every((x) => typeof x === "string" && x.length > 0 && x.length <= 120) ? v : invalid("invalid string list");
var integer = (v, min, max) => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max ? v : invalid("invalid integer");
var bool = (v) => typeof v === "boolean" ? v : invalid("missing boolean capability");
var keys = (v, names) => {
  if (Object.keys(v).some((k) => !names.includes(k)) || names.some((k) => !Object.hasOwn(v, k)))
    invalid("unexpected or missing fields");
};
function parseBoardDefinition(input) {
  const b = record(input);
  keys(b, [
    "schemaVersion",
    "id",
    "name",
    "manufacturer",
    "revision",
    "mcu",
    "cpu",
    "physicalPins",
    "numberingConvention",
    "dimensionsMm",
    "dimensionStatus",
    "verification",
    "memory",
    "onboard",
    "internalNets",
    "sources",
    "pins"
  ]);
  if (b.schemaVersion !== "1.0.0" || b.id !== "yd-esp32-s3-2022-v1.3" || b.mcu !== "ESP32-S3" || b.physicalPins !== 44)
    invalid("unsupported identity or44-pin schema");
  for (const key of [
    "name",
    "manufacturer",
    "revision",
    "cpu",
    "numberingConvention"
  ])
    text(b[key]);
  if (b.dimensionsMm !== null) {
    const d = record(b.dimensionsMm);
    keys(d, ["width", "height"]);
    for (const key of ["width", "height"])
      if (typeof d[key] !== "number" || !Number.isFinite(d[key]) || d[key] <= 0 || d[key] > 200)
        invalid("invalid dimensions");
  }
  if (!["requires-confirmation", "manufacturer-drawing-verified"].includes(
    String(b.dimensionStatus)
  ))
    invalid("invalid dimension verification");
  const v = record(b.verification);
  keys(v, ["pinout", "exactRevision", "note"]);
  if (v.pinout !== "manufacturer-family-verified" || v.exactRevision !== "requires-confirmation")
    invalid("unverified exact board revision");
  text(v.note);
  const memory = record(b.memory);
  keys(memory, ["defaultVariant", "profiles"]);
  if (memory.defaultVariant !== "unconfirmed")
    invalid("memory variant requires module confirmation");
  const profiles = record(memory.profiles);
  keys(profiles, ["N16R8"]);
  const n = record(profiles.N16R8);
  keys(n, ["flashMB", "psramMB", "psramMode", "reservedGpio", "verification"]);
  if (n.flashMB !== 16 || n.psramMB !== 8 || n.psramMode !== "octal" || n.verification !== "module-marking-required" || JSON.stringify(n.reservedGpio) !== "[35,36,37]")
    invalid("invalid N16R8 profile");
  if (!Array.isArray(b.pins) || b.pins.length !== 44)
    invalid("expected44 pins");
  const ids = /* @__PURE__ */ new Set();
  const gpios = /* @__PURE__ */ new Set();
  b.pins.forEach((entry, index) => {
    const p = record(entry);
    keys(p, [
      "id",
      "physicalNumber",
      "header",
      "headerIndex",
      "side",
      "label",
      "gpio",
      "arduinoPin",
      "electricalType",
      "functions",
      "restrictions",
      "adc",
      "ledc",
      "i2c",
      "spi",
      "uart"
    ]);
    const side = index < 22 ? "left" : "right", header = index < 22 ? "P1" : "P2", headerIndex = index % 22 + 1;
    if (p.header !== header || p.side !== side || p.headerIndex !== headerIndex || p.physicalNumber !== index + 1 || p.id !== `${header}.${headerIndex}`)
      invalid("physical position/header mismatch");
    const id2 = text(p.id);
    if (ids.has(id2)) invalid("duplicate pin ID");
    ids.add(id2);
    text(p.label, 40);
    const expected = (index < 22 ? leftGPIO : rightGPIO)[headerIndex - 1];
    if (p.gpio !== expected || p.arduinoPin !== expected)
      invalid("GPIO/Arduino alias does not match published header");
    const specialLabels = {
      0: "3V3",
      1: "3V3",
      2: "RST",
      20: "5V",
      21: "G",
      22: "G",
      23: "TX",
      24: "RX",
      42: "G",
      43: "G"
    };
    const expectedLabel = specialLabels[index] ?? String(expected);
    if (p.label !== expectedLabel)
      invalid("pin label does not match published header");
    if (p.gpio === null && p.electricalType !== (expectedLabel === "RST" ? "input" : expectedLabel === "G" ? "ground" : "power"))
      invalid("power/reset electrical type mismatch");
    if (p.gpio !== null) {
      const gpio = integer(p.gpio, 0, 48);
      if (gpios.has(gpio)) invalid("duplicate GPIO");
      gpios.add(gpio);
      if (p.electricalType !== "bidirectional")
        invalid("invalid GPIO electrical type");
    } else if (!["power", "ground", "input"].includes(String(p.electricalType)))
      invalid("invalid non-GPIO electrical type");
    strings(p.functions);
    const restrictions = strings(p.restrictions);
    if (expected !== null && [0, 3, 45, 46].includes(expected) && !restrictions.includes("strapping"))
      invalid("missing strapping restriction");
    if (expected !== null && [35, 36, 37].includes(expected) && !restrictions.includes("reserved-on-octal-memory-variants"))
      invalid("missing memory reservation");
    const adc = expected !== null && expected >= 1 && expected <= 10 ? { unit: 1, channel: expected - 1 } : expected !== null && expected >= 11 && expected <= 20 ? { unit: 2, channel: expected - 11 } : null;
    if (adc === null) {
      if (p.adc !== null) invalid("ADC not available");
    } else {
      const a = record(p.adc);
      keys(a, ["unit", "channel"]);
      if (a.unit !== adc.unit || a.channel !== adc.channel)
        invalid("ADC channel mismatch");
    }
    for (const key of ["ledc", "i2c", "spi"])
      if (bool(p[key]) !== (expected !== null))
        invalid("GPIO capability mismatch");
    const uart = record(p.uart);
    keys(uart, ["tx", "rx"]);
    if (bool(uart.tx) !== (expected !== null) || bool(uart.rx) !== (expected !== null))
      invalid("UART capability mismatch");
  });
  const onboard = record(b.onboard);
  keys(onboard, ["rgb", "boot", "reset", "usb"]);
  const rgb = record(onboard.rgb);
  keys(rgb, ["gpio", "type", "verification"]);
  if (rgb.gpio !== 48 || rgb.type !== "WS2812" || rgb.verification !== "manufacturer-family")
    invalid("invalid onboard RGB mapping");
  const boot = record(onboard.boot);
  keys(boot, ["gpio", "activeLow"]);
  if (boot.gpio !== 0 || boot.activeLow !== true)
    invalid("invalid BOOT mapping");
  const reset = record(onboard.reset);
  keys(reset, ["signal", "activeLow"]);
  if (reset.signal !== "EN" || reset.activeLow !== true)
    invalid("invalid reset mapping");
  if (!Array.isArray(onboard.usb) || onboard.usb.length !== 2)
    invalid("expected two USB connectors");
  const native = record(onboard.usb[0]);
  keys(native, ["type", "role", "gpioDm", "gpioDp"]);
  if (native.type !== "USB-C" || native.role !== "native" || native.gpioDm !== 19 || native.gpioDp !== 20)
    invalid("invalid native USB mapping");
  const bridge = record(onboard.usb[1]);
  keys(bridge, ["type", "role", "bridge", "uartTx", "uartRx"]);
  if (bridge.type !== "USB-C" || bridge.role !== "usb-to-uart" || bridge.bridge !== "CH343P" || bridge.uartTx !== 43 || bridge.uartRx !== 44)
    invalid("invalid bridge mapping");
  if (!Array.isArray(b.internalNets) || JSON.stringify(b.internalNets) !== JSON.stringify([
    { name: "3V3", pinIds: ["P1.1", "P1.2"] },
    { name: "GND", pinIds: ["P1.22", "P2.1", "P2.21", "P2.22"] }
  ]))
    invalid("invalid shared rail mapping");
  if (!Array.isArray(b.sources) || b.sources.length < 2 || b.sources.length > 10)
    invalid("missing sources");
  for (const source of b.sources) {
    const s = record(source);
    keys(s, ["url", "revision", "purpose"]);
    if (!text(s.url).startsWith("https://")) invalid("invalid source URL");
    text(s.revision);
    text(s.purpose);
  }
  return structuredClone(input);
}
var ydBoard = parseBoardDefinition(yd_esp32_s3_default);
function supportsGPIOOutput(pin2, memoryVariant = "unconfirmed") {
  if (pin2.gpio === null || pin2.restrictions.includes("input-only"))
    return false;
  if (pin2.restrictions.includes("reserved-on-octal-memory-variants") && (memoryVariant === "N16R8" || memoryVariant === "unconfirmed" || !Object.hasOwn(ydBoard.memory.profiles, memoryVariant)))
    return false;
  return true;
}

// ../simulab-frontend/src/models/definitions.ts
var pins2 = (names) => names.map((id2) => ({
  id: id2,
  label: id2,
  electricalType: ["VCC", "VDD", "VM"].includes(id2) ? "power-input" : id2 === "GND" ? "ground-input" : "bidirectional"
}));
var deviceDefinitions = {
  ds3231: {
    name: "DS3231 RTC",
    description: "I2C RTC with BCD calendar, alarms and simulation-clock time",
    pins: pins2(["VCC", "GND", "SDA", "SCL", "SQW", "32K"]),
    defaultProperties: { address: 104, epoch: "2026-01-01T00:00:00Z" }
  },
  mux4067: {
    name: "16-channel multiplexer",
    description: "HC / B profiles; ideal bidirectional contacts with switching delay",
    pins: pins2([
      "VCC",
      "GND",
      "S0",
      "S1",
      "S2",
      "S3",
      "COM",
      "EN",
      ...Array.from({ length: 16 }, (_, i) => `C${i}`)
    ]),
    defaultProperties: { variant: "HC" }
  },
  "dc-motor": {
    name: "DC brushed motor",
    description: "Approximate winding, back-EMF, inertia and load; requires powered driver",
    pins: pins2(["POS", "NEG"]),
    defaultProperties: {
      ratedVoltage: 6,
      ratedRpm: 6e3,
      resistance: 3,
      inertia: 1e-5,
      load: 0,
      stalled: false
    }
  },
  ws2812: {
    name: "WS2812B RGB LED / strip",
    description: "GRB timed-edge decoding; Uno only until S3 edge callbacks exist",
    pins: pins2(["VDD", "GND", "DIN", "DOUT"]),
    defaultProperties: { count: 1, brightness: 1 }
  },
  relay: {
    name: "5V relay module",
    description: "Powered driver module with isolated COM/NO/NC contacts",
    pins: pins2(["VCC", "GND", "IN", "COM", "NO", "NC"]),
    defaultProperties: {
      activeLow: true,
      logic3v3: false,
      delayUs: 1e4,
      ratingV: 30,
      ratingA: 10
    }
  },
  "h-bridge": {
    name: "Ideal H-bridge driver",
    description: "Powered bidirectional motor driver; duty follows actual enable signal",
    pins: pins2(["VM", "VCC", "GND", "IN1", "IN2", "EN", "OUT1", "OUT2"]),
    defaultProperties: { maxCurrentA: 3 }
  }
};

// ../simulab-frontend/src/circuit/catalog.ts
var pin = (id2, electricalType = "passive") => ({
  id: id2,
  label: id2,
  electricalType
});
var catalog = {
  "serial-monitor": {
    name: "Serial Monitor",
    description: "Wired firmware UART0 terminal; S3 uses a separate virtual guest CONSOLE link",
    pins: [
      pin("RX", "input"),
      pin("TX", "output"),
      pin("GND", "ground"),
      {
        id: "CONSOLE",
        label: "CONSOLE (virtual S3)",
        electricalType: "virtual-console"
      }
    ],
    defaultProperties: {}
  },
  debugger: {
    name: "Debugger",
    description: "Virtual CPU attachment; actual AVR instruction registers and stepping, adapter-gated controls",
    pins: [
      {
        id: "DEBUG",
        label: "DEBUG (virtual)",
        electricalType: "virtual-debug"
      }
    ],
    defaultProperties: {}
  },
  ...deviceDefinitions,
  ...expandedDefinitions,
  nano: {
    name: "Arduino Nano classic",
    description: "ATmega328P 16 MHz; A6/A7 ADC-only, analog conversion not implemented",
    pins: boardPins("nano"),
    defaultProperties: { clockHz: 16e6 }
  },
  mega2560: {
    name: "Arduino Mega 2560",
    description: "ATmega2560 16 MHz; native D0..53/A0..15; host requires separate Mega CPU profile",
    pins: boardPins("mega2560"),
    defaultProperties: { clockHz: 16e6 }
  },
  uno: {
    name: "Arduino Uno",
    description: "ATmega328P board / genuine AVR instruction execution",
    pins: [
      ...Array.from({ length: 14 }, (_, i) => pin(`D${i}`, "bidirectional")),
      ...Array.from({ length: 6 }, (_, i) => pin(`A${i}`, "analog")),
      pin("5V", "power"),
      pin("3V3", "power"),
      pin("GND", "ground"),
      pin("VIN", "power-input"),
      pin("RESET", "input"),
      pin("AREF", "analog-reference")
    ],
    defaultProperties: { clockHz: 16e6 }
  },
  "yd-esp32-s3": {
    name: "YD-ESP32-S3-2022-V1.3",
    description: "44 physical pins / ESP32-S3 / exact revision and module marking require confirmation",
    pins: ydBoard.pins.map((p) => ({
      id: p.id,
      label: p.label,
      electricalType: p.electricalType
    })),
    defaultProperties: {
      memoryVariant: "unconfirmed",
      boardRevision: "2022-V1.3"
    }
  },
  led: {
    name: "LED",
    description: "Polarized indicator   A anode / K cathode",
    pins: [pin("A"), pin("K")],
    defaultProperties: { color: "#ef6461" }
  },
  resistor: {
    name: "Resistor",
    description: "Linear DC resistor; bounded resistive network solution",
    pins: [pin("1"), pin("2")],
    defaultProperties: { resistanceOhms: 220 }
  },
  switch: {
    name: "Push button",
    description: "Normally open switch / live digital contact input",
    pins: [pin("1"), pin("2")],
    defaultProperties: { pressed: false }
  },
  junction: {
    name: "Junction",
    description: "Explicit shared electrical node",
    pins: [pin("J")],
    defaultProperties: {}
  }
};
function componentPins(kind) {
  return [...catalog[kind].pins, ...virtualBoardPins(kind)];
}
function createComponent(kind, position) {
  return {
    id: crypto.randomUUID(),
    kind,
    label: catalog[kind].name,
    position: { ...position },
    rotation: 0,
    properties: { ...catalog[kind].defaultProperties }
  };
}

// ../simulab-frontend/src/circuit/netlist.ts
var endpointKey = (e) => JSON.stringify([e.componentId, e.pinId]);
function hasEndpoint(project, e) {
  const c = project.components.find((c2) => c2.id === e.componentId);
  return !!c && componentPins(c.kind).some((p) => p.id === e.pinId);
}
function buildNets(project) {
  const endpoints = /* @__PURE__ */ new Map();
  const adjacency = /* @__PURE__ */ new Map();
  for (const c of project.components)
    for (const p of componentPins(c.kind)) {
      const endpoint2 = { componentId: c.id, pinId: p.id };
      const k = endpointKey(endpoint2);
      endpoints.set(k, endpoint2);
      adjacency.set(k, /* @__PURE__ */ new Set());
    }
  for (const component of project.components.filter(
    (c) => c.kind === "yd-esp32-s3"
  )) {
    for (const group of ydBoard.internalNets) {
      const keys2 = group.pinIds.map(
        (pinId) => endpointKey({ componentId: component.id, pinId })
      );
      for (const key of keys2.slice(1)) {
        adjacency.get(keys2[0]).add(key);
        adjacency.get(key).add(keys2[0]);
      }
    }
  }
  for (const w of project.wires) {
    const a = endpointKey(w.from), b = endpointKey(w.to);
    if (adjacency.has(a) && adjacency.has(b)) {
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    }
  }
  const seen = /* @__PURE__ */ new Set();
  const nets = [];
  for (const start of [...endpoints.keys()].sort()) {
    if (seen.has(start)) continue;
    const stack = [start];
    const members = [];
    seen.add(start);
    while (stack.length) {
      const k = stack.pop();
      members.push(endpoints.get(k));
      for (const next of adjacency.get(k))
        if (!seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
    }
    members.sort((a, b) => endpointKey(a).localeCompare(endpointKey(b)));
    nets.push({ id: `net-${nets.length + 1}`, endpoints: members });
  }
  return nets;
}
function electricalCircuit(project) {
  const virtual = /* @__PURE__ */ new Set();
  const byId = new Map(project.components.map((c) => [c.id, c]));
  for (const component of project.components)
    for (const pin2 of componentPins(component.kind))
      if (pin2.electricalType.startsWith("virtual-"))
        virtual.add(endpointKey({ componentId: component.id, pinId: pin2.id }));
  if (!project.wires.some(
    (wire) => virtual.has(endpointKey(wire.from)) || virtual.has(endpointKey(wire.to))
  ))
    return { project, issues: [] };
  const excluded = /* @__PURE__ */ new Set(), issues = [];
  for (const net of buildNets(project)) {
    if (!net.endpoints.some((endpoint2) => virtual.has(endpointKey(endpoint2))))
      continue;
    for (const endpoint2 of net.endpoints) excluded.add(endpointKey(endpoint2));
    if (net.endpoints.some(
      (endpoint2) => !virtual.has(endpointKey(endpoint2)) && byId.get(endpoint2.componentId)?.kind !== "junction"
    ))
      issues.push(
        "Virtual simulator service ports cannot carry electrical GPIO signals; this service net is electrically isolated."
      );
  }
  return {
    project: {
      ...project,
      wires: project.wires.filter(
        (wire) => !excluded.has(endpointKey(wire.from)) && !excluded.has(endpointKey(wire.to))
      )
    },
    issues
  };
}

// ../simulab-frontend/src/models/ds3231.ts
var bcd = (n) => Math.floor(n / 10) << 4 | n % 10;
var dec = (n) => (n >> 4) * 10 + (n & 15);
var hour = (n) => n & 64 ? dec(n & 31) % 12 + (n & 32 ? 12 : 0) : dec(n & 63);
var Ds3231 = class {
  address;
  registers = new Uint8Array(19);
  pointer = 0;
  epoch;
  timeUs = 0;
  fractionUs = 0;
  twelveHour = false;
  day = 1;
  constructor(options = {}) {
    this.address = options.address ?? 104;
    this.epoch = Date.parse(options.epoch ?? "2026-01-01T00:00:00Z");
    if (!Number.isFinite(this.epoch) || this.epoch < Date.UTC(2e3, 0, 1) || this.epoch >= Date.UTC(2200, 0, 1))
      throw new Error("RTC epoch must be in 2000..2199");
    if (!Number.isInteger(this.address) || this.address < 8 || this.address > 119)
      throw new Error("Invalid I2C address");
    this.day = new Date(this.epoch).getUTCDay() + 1;
    this.registers[14] = 28;
    this.registers[15] = 136;
    this.registers[17] = 25;
    this.refresh();
  }
  refresh() {
    const d = new Date(this.epoch), h = d.getUTCHours();
    this.registers.set(
      [
        bcd(d.getUTCSeconds()),
        bcd(d.getUTCMinutes()),
        this.twelveHour ? 64 | (h >= 12 ? 32 : 0) | bcd(h % 12 || 12) : bcd(h),
        this.day,
        bcd(d.getUTCDate()),
        bcd(d.getUTCMonth() + 1) | (d.getUTCFullYear() >= 2100 ? 128 : 0),
        bcd(d.getUTCFullYear() % 100)
      ],
      0
    );
  }
  alarm(offset, second) {
    const d = new Date(this.epoch), r = this.registers;
    let i = offset;
    if (second && !(r[i] & 128) && dec(r[i] & 127) !== d.getUTCSeconds())
      return false;
    if (second) i++;
    if (!(r[i] & 128) && dec(r[i] & 127) !== d.getUTCMinutes()) return false;
    i++;
    if (!(r[i] & 128) && hour(r[i] & 127) !== d.getUTCHours()) return false;
    i++;
    return !!(r[i] & 128) || dec(r[i] & 63) === (r[i] & 64 ? this.day : d.getUTCDate());
  }
  /** @brief Advance to absolute simulation microseconds, latching every intervening alarm second. */
  advance(timeUs) {
    if (!Number.isFinite(timeUs) || timeUs < this.timeUs)
      throw new Error("RTC time must be monotonic");
    this.fractionUs += timeUs - this.timeUs;
    this.timeUs = timeUs;
    const seconds = Math.floor(this.fractionUs / 1e6);
    if (seconds > 86400)
      throw new Error("RTC advance exceeds one-day batch limit");
    this.fractionUs -= seconds * 1e6;
    for (let n = 0; n < seconds; n++) {
      this.epoch += 1e3;
      const d = new Date(this.epoch);
      if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0)
        this.day = this.day % 7 + 1;
      if (this.alarm(7, true)) this.registers[15] |= 1;
      if (d.getUTCSeconds() === 0 && this.alarm(11, false))
        this.registers[15] |= 2;
    }
    this.refresh();
  }
  /** @brief Perform a complete I2C write: first byte is register pointer; false means NACK. */
  write(address, bytes) {
    if (address !== this.address) return false;
    if (!bytes.length || bytes.some((v) => !Number.isInteger(v) || v < 0 || v > 255))
      throw new Error("Invalid I2C write");
    this.pointer = bytes[0] % 19;
    for (const value of bytes.slice(1)) {
      const p = this.pointer;
      if (p === 15)
        this.registers[p] = this.registers[p] & value & 131 | value & 8;
      else if (p < 17) this.registers[p] = value;
      if (p <= 6) {
        const r = this.registers;
        this.twelveHour = !!(r[2] & 64);
        this.day = Math.min(7, Math.max(1, r[3] & 7));
        const year = 2e3 + dec(r[6]) + (r[5] & 128 ? 100 : 0);
        this.epoch = Date.UTC(
          year,
          Math.max(0, dec(r[5] & 31) - 1),
          Math.max(1, dec(r[4] & 63)),
          hour(r[2]),
          dec(r[1] & 127),
          dec(r[0] & 127)
        );
        if (p === 0) this.fractionUs = 0;
      }
      this.pointer = (p + 1) % 19;
    }
    this.refresh();
    return true;
  }
  /** @brief Read sequential registers after setting the register pointer. */
  read(address, count) {
    if (address !== this.address) return [];
    if (!Number.isInteger(count) || count < 0 || count > 256)
      throw new Error("Invalid I2C read length");
    return Array.from({ length: count }, () => {
      const v = this.registers[this.pointer];
      this.pointer = (this.pointer + 1) % 19;
      return v;
    });
  }
  /** @brief Return observable state; SQW and 32K are sampled levels, INT is open-drain. */
  snapshot() {
    const control = this.registers[14], status = this.registers[15];
    const hz = [1, 1024, 4096, 8192][control >> 3 & 3];
    return {
      iso: new Date(this.epoch).toISOString(),
      lostPower: !!(status & 128),
      alarm1: !!(status & 1),
      alarm2: !!(status & 2),
      interruptLow: !!(control & 4 && (control & 1 && status & 1 || control & 2 && status & 2)),
      sqw: control & 4 ? null : Math.floor(this.timeUs * hz * 2 / 1e6) % 2,
      clock32k: status & 8 ? Math.floor(this.timeUs * 32768 * 2 / 1e6) % 2 : null
    };
  }
};

// ../simulab-frontend/src/models/mux4067.ts
var muxProfiles = {
  HC: { min: 2, max: 6, delayUs: 0.1, onOhms: 70 },
  B: { min: 3, max: 18, delayUs: 0.3, onOhms: 125 }
};
var Mux4067 = class {
  constructor(variant = "HC") {
    this.variant = variant;
    if (!muxProfiles[variant]) throw new Error("Unknown 4067 variant");
  }
  variant;
  time = 0;
  selected = null;
  changed = 0;
  /** @param timeUs Absolute simulation time. @param pins Resolved supply, select, inhibit and signal voltages. */
  update(timeUs, pins3) {
    checkTime(timeUs, this.time);
    this.time = timeUs;
    const profile = muxProfiles[this.variant], g = pins3.GND, supply2 = pins3.VCC;
    const warnings = [];
    const v = typeof g === "number" && typeof supply2 === "number" ? supply2 - g : NaN;
    const valid = Number.isFinite(v) && v >= profile.min && v <= profile.max;
    if (!valid)
      warnings.push(
        `${this.variant} supply must be ${profile.min}..${profile.max} V`
      );
    const logic2 = (key) => {
      const n = pins3[key];
      if (typeof n !== "number" || typeof g !== "number") return null;
      return n - g <= 0.3 * v ? 0 : n - g >= 0.7 * v ? 1 : null;
    };
    const bits = [0, 1, 2, 3].map((i) => logic2(`S${i}`));
    const next = valid && logic2("EN") === 0 && bits.every((b) => b !== null) ? bits.reduce((n, b, i) => n + ((b ?? 0) << i), 0) : null;
    if (next !== this.selected) {
      this.selected = next;
      this.changed = timeUs;
    }
    let channel = timeUs - this.changed >= profile.delayUs ? this.selected : null;
    if (channel !== null)
      for (const key of ["COM", `C${channel}`]) {
        const n = pins3[key];
        if (typeof n === "number" && (n < g || n > supply2)) {
          warnings.push(`${key} signal outside supply range`);
          channel = null;
          break;
        }
      }
    const contacts = channel === null ? [] : [["COM", `C${channel}`]];
    return {
      channel,
      contacts,
      warnings,
      onOhms: profile.onOhms,
      value: channel === null ? null : pins3[`C${channel}`] ?? pins3.COM ?? null
    };
  }
};

// ../simulab-frontend/src/models/motor.ts
var DcMotor = class {
  constructor(config) {
    this.config = config;
    bounded(config.ratedVoltage, 0.1, 48, "Rated voltage");
    bounded(config.ratedRpm, 1, 1e5, "Rated RPM");
    bounded(config.resistance, 0.01, 1e5, "Resistance");
    bounded(config.inertia, 1e-9, 100, "Inertia");
    bounded(config.load, 0, 100, "Load");
    this.ke = config.ratedVoltage / (config.ratedRpm * Math.PI / 30);
  }
  config;
  time = 0;
  omega = 0;
  angle = 0;
  ke;
  /** @brief Integrate exact first-order winding/mechanical approximation at the supplied terminal voltage. */
  update(timeUs, voltage, stalled = false) {
    checkTime(timeUs, this.time);
    bounded(voltage, -100, 100, "Terminal voltage");
    const dt = (timeUs - this.time) / 1e6;
    this.time = timeUs;
    const { resistance: r, inertia: j, load } = this.config;
    const friction = load + this.ke * this.ke / r + 1e-7;
    const target = this.ke * voltage / r / friction;
    const previous = this.omega;
    this.omega = stalled ? 0 : target + (this.omega - target) * Math.exp(-friction / j * dt);
    this.angle = (this.angle + (previous + this.omega) * 0.5 * dt) % (2 * Math.PI);
    const backEmfV = this.omega * this.ke, currentA = (voltage - backEmfV) / r;
    return {
      rpm: this.omega * 30 / Math.PI,
      currentA,
      torqueNm: currentA * this.ke,
      backEmfV,
      angle: this.angle,
      stalled,
      direction: this.omega >= 0 ? "CW" : "CCW"
    };
  }
};

// ../simulab-frontend/src/models/relay.ts
var RelayModule = class {
  constructor(profile) {
    this.profile = profile;
    bounded(profile.delayUs, 0, 1e6, "Switch delay");
  }
  profile;
  time = 0;
  changed = 0;
  requested = false;
  energized = false;
  /** @brief Resolve input logic and mechanical delay; uncertain logic releases the relay after delay. */
  update(timeUs, pins3) {
    checkTime(timeUs, this.time);
    this.time = timeUs;
    const warnings = [], g = pins3.GND, v = pins3.VCC, input = pins3.IN;
    const powered = typeof v === "number" && typeof g === "number" && v - g >= 4.5 && v - g <= 5.5;
    if (!powered) warnings.push("Relay module needs 4.5..5.5 V supply");
    const relative = typeof input === "number" && typeof g === "number" ? input - g : NaN;
    const high = relative >= (this.profile.logic3v3 ? 2 : 3.5) && relative <= 5.5, low = relative >= 0 && relative <= 0.8;
    if (!high && !low)
      warnings.push(
        "Relay input floating/ambiguous; 3.3 V compatibility depends on module profile"
      );
    const requested = powered && (this.profile.activeLow ? low : high);
    if (requested !== this.requested) {
      this.requested = requested;
      this.changed = timeUs;
    }
    if (timeUs - this.changed >= this.profile.delayUs)
      this.energized = requested;
    const contacts = [["COM", this.energized ? "NO" : "NC"]];
    const contactVoltage = pins3.COM;
    if (typeof contactVoltage === "number" && Math.abs(contactVoltage) > (this.profile.ratingV ?? 30))
      warnings.push(
        "Contact voltage exceeds configured DC rating; mains simulation is unsupported"
      );
    return {
      energized: this.energized,
      contacts,
      warnings,
      currentA: powered ? this.energized ? 0.075 : 3e-3 : 0
    };
  }
};

// ../simulab-frontend/src/models/ws2812.ts
var Ws2812 = class {
  constructor(count = 1, brightness = 1, offset = 0) {
    this.count = count;
    this.brightness = brightness;
    this.offset = offset;
    bounded(count, 1, 256, "LED count");
    if (!Number.isInteger(count)) throw new Error("LED count must be integer");
    bounded(brightness, 0, 1, "Brightness");
    this.pixels = Array.from({ length: count }, () => [0, 0, 0]);
    bounded(offset, 0, 255, "Chain offset");
    if (count + offset > 256) throw new Error("Chain exceeds 256 pixels");
  }
  count;
  brightness;
  offset;
  time = 0;
  rise = 0;
  fall = 0;
  level = 0;
  bits = [];
  pixels;
  errors = 0;
  invalid = false;
  /** @brief Consume a real GPIO edge. High widths distinguish zero/one, malformed frames are discarded. */
  edge(timeUs, level) {
    this.advance(timeUs);
    if (level === this.level) return;
    if (level === 1) {
      if (this.bits.length && timeUs - this.fall > 1.1 && timeUs - this.fall < 280) {
        this.invalid = true;
        this.errors++;
      }
      this.rise = timeUs;
    } else {
      const high = timeUs - this.rise;
      if (high >= 0.2 && high <= 0.5) this.bits.push(0);
      else if (high >= 0.55 && high <= 0.95) this.bits.push(1);
      else {
        this.invalid = true;
        this.errors++;
      }
      if (this.bits.length > 256 * 24) {
        this.invalid = true;
        this.bits = [];
        this.errors++;
      }
      this.fall = timeUs;
    }
    this.level = level;
  }
  /** @brief Latch only complete valid frames after the reset low interval. */
  advance(timeUs) {
    checkTime(timeUs, this.time);
    this.time = timeUs;
    if (this.level === 0 && timeUs - this.fall >= 280 && (this.bits.length || this.invalid)) {
      if (!this.invalid && this.bits.length >= (this.count + this.offset) * 24) {
        for (let n = 0; n < this.count; n++) {
          const byte = (offset) => this.bits.slice(
            (n + this.offset) * 24 + offset,
            (n + this.offset) * 24 + offset + 8
          ).reduce((a, b) => a * 2 + b, 0);
          this.pixels[n] = [byte(8), byte(0), byte(16)];
        }
      } else if (!this.invalid) this.errors++;
      this.bits = [];
      this.invalid = false;
    }
  }
  /** @brief Read RGB output and an approximate 20mA-per-channel power estimate. */
  snapshot() {
    return {
      colors: this.pixels.map(
        (p) => "#" + p.map(
          (v) => Math.round(v * this.brightness).toString(16).padStart(2, "0")
        ).join("")
      ),
      currentA: this.count * 1e-3 + this.pixels.flat().reduce((a, b) => a + b, 0) / 255 * 0.02 * this.brightness,
      errors: this.errors
    };
  }
  /** @brief Remove power: clear volatile pixels/partial frame, preserving the absolute host time. */
  powerOff() {
    this.pixels = Array.from({ length: this.count }, () => [0, 0, 0]);
    this.bits = [];
    this.invalid = false;
    this.level = 0;
    this.fall = this.time;
  }
};

// ../simulab-frontend/src/models/circuitRuntime.ts
var empty = () => ({
  values: {},
  warnings: [],
  contacts: [],
  outputs: {}
});
var CircuitRuntime = class {
  constructor(project, target, factories = {}) {
    this.project = project;
    this.target = target;
    project = electricalCircuit(project).project;
    this.project = structuredClone(project);
    for (const c of project.components) {
      if (factories[c.kind]) {
        this.extensions.set(c.id, factories[c.kind](c));
        this.states[c.id] = empty();
        continue;
      }
      const extension = createExpandedModel(c, this.optical);
      if (extension) {
        this.extensions.set(c.id, extension);
        this.states[c.id] = empty();
        continue;
      }
      if (["voltmeter", "ammeter"].includes(c.kind))
        this.states[c.id] = empty();
      const p = { ...catalog[c.kind].defaultProperties, ...c.properties };
      if (c.kind === "ds3231")
        this.models.set(
          c.id,
          new Ds3231({ epoch: String(p.epoch), address: Number(p.address) })
        );
      if (c.kind === "mux4067")
        this.models.set(c.id, new Mux4067(String(p.variant)));
      if (c.kind === "dc-motor")
        this.models.set(
          c.id,
          new DcMotor({
            ratedVoltage: Number(p.ratedVoltage),
            ratedRpm: Number(p.ratedRpm),
            resistance: Number(p.resistance),
            inertia: Number(p.inertia),
            load: Number(p.load)
          })
        );
      if (c.kind === "relay")
        this.models.set(
          c.id,
          new RelayModule({
            activeLow: p.activeLow === true,
            logic3v3: p.logic3v3 === true,
            delayUs: Number(p.delayUs),
            ratingV: Number(p.ratingV),
            ratingA: Number(p.ratingA)
          })
        );
      if (c.kind === "ws2812") {
        const nets = buildNets(project), net = (id2, pin2) => nets.find(
          (n) => n.endpoints.some((e) => e.componentId === id2 && e.pinId === pin2)
        );
        let upstream = c, offset = 0;
        const seen = /* @__PURE__ */ new Set([c.id]);
        while (true) {
          const n = net(upstream.id, "DIN");
          const previous = project.components.find(
            (part) => part.kind === "ws2812" && n?.endpoints.some(
              (e) => e.componentId === part.id && e.pinId === "DOUT"
            )
          );
          if (!previous) break;
          if (seen.has(previous.id))
            throw new Error("WS2812 chain forms a loop");
          seen.add(previous.id);
          offset += Number(previous.properties.count ?? 1);
          upstream = previous;
        }
        this.wsSources.set(c.id, upstream.id);
        this.wsChains.set(c.id, [...seen]);
        this.models.set(
          c.id,
          new Ws2812(Number(p.count), Number(p.brightness), offset)
        );
      }
      if (this.models.has(c.id) || c.kind === "h-bridge")
        this.states[c.id] = empty();
    }
    this.resolve();
  }
  project;
  target;
  models = /* @__PURE__ */ new Map();
  states = {};
  pins = {};
  netOf = /* @__PURE__ */ new Map();
  time = 0;
  gpio = {};
  powered = /* @__PURE__ */ new Set();
  transactions = [];
  wsSources = /* @__PURE__ */ new Map();
  wsChains = /* @__PURE__ */ new Map();
  extensions = /* @__PURE__ */ new Map();
  optical = new OpticalChannel();
  dcCurrents = {};
  dcIssues = [];
  key(c, p) {
    return endpointKey({ componentId: c, pinId: p });
  }
  resolve() {
    const parent = /* @__PURE__ */ new Map();
    for (const c of this.project.components)
      for (const p of catalog[c.kind].pins) {
        const k = this.key(c.id, p.id);
        parent.set(k, k);
      }
    const root = (k) => {
      const p = parent.get(k);
      return !p || p === k ? k : root(p);
    };
    const join = (a, b) => parent.set(root(a), root(b));
    for (const n of buildNets(this.project))
      for (const e of n.endpoints.slice(1))
        join(endpointKey(n.endpoints[0]), endpointKey(e));
    for (const c of this.project.components) {
      for (const [a, b] of this.states[c.id]?.contacts ?? [])
        join(this.key(c.id, a), this.key(c.id, b));
      if (c.kind === "switch" && c.properties.pressed === true)
        join(this.key(c.id, "1"), this.key(c.id, "2"));
      if (c.kind === "tactile-switch") {
        join(this.key(c.id, "1A"), this.key(c.id, "1B"));
        join(this.key(c.id, "2A"), this.key(c.id, "2B"));
        if (c.properties.pressed === true)
          join(this.key(c.id, "1A"), this.key(c.id, "2A"));
      }
    }
    this.netOf = new Map([...parent.keys()].map((k) => [k, root(k)]));
    const drivers = /* @__PURE__ */ new Map();
    const drive = (id2, pin2, v) => {
      if (v === null) return;
      const net = root(this.key(id2, pin2));
      drivers.set(net, [...drivers.get(net) ?? [], v]);
    };
    for (const c of this.project.components) {
      if (isMcuKind(c.kind) && c.kind !== "yd-esp32-s3") {
        drive(c.id, "5V", 5);
        drive(c.id, "3V3", 3.3);
        drive(c.id, "GND", 0);
        for (const [pin2, v] of Object.entries(this.gpio))
          if (v !== null && catalog[c.kind].pins.some(
            (p) => p.id === pin2 && ["bidirectional", "analog"].includes(p.electricalType)
          ))
            drive(c.id, pin2, v * 5);
      }
      if (c.kind === "yd-esp32-s3")
        for (const p of ydBoard.pins) {
          if (p.electricalType === "ground") drive(c.id, p.id, 0);
          if (p.electricalType === "power")
            drive(c.id, p.id, p.label === "3V3" ? 3.3 : 5);
          if (p.gpio !== null && this.gpio[`GPIO${p.gpio}`] != null)
            drive(c.id, p.id, this.gpio[`GPIO${p.gpio}`] * 3.3);
        }
      for (const [pin2, v] of Object.entries(this.states[c.id]?.outputs ?? {}))
        drive(c.id, pin2, v);
    }
    const nodes = [...new Set([...parent.keys()].map(root))], branches = [];
    for (const c of this.project.components) {
      if (c.kind === "resistor")
        branches.push({
          id: c.id,
          a: root(this.key(c.id, "1")),
          b: root(this.key(c.id, "2")),
          ohms: Number(c.properties.resistanceOhms ?? 220)
        });
      if (c.kind === "electromagnetic-switch")
        branches.push({
          id: c.id,
          a: root(this.key(c.id, "COIL_POS")),
          b: root(this.key(c.id, "COIL_NEG")),
          ohms: Number(c.properties.resistanceOhms ?? 70)
        });
      if (c.kind === "ammeter")
        branches.push({
          id: c.id,
          a: root(this.key(c.id, "POS")),
          b: root(this.key(c.id, "NEG")),
          ohms: Number(c.properties.shuntOhms ?? 0.1)
        });
    }
    const dc = solveDc(nodes, Object.fromEntries(drivers), branches);
    this.dcCurrents = dc.currents;
    this.dcIssues = dc.issues;
    this.pins = {};
    for (const c of this.project.components) {
      this.pins[c.id] = {};
      for (const p of catalog[c.kind].pins)
        this.pins[c.id][p.id] = dc.volts[root(this.key(c.id, p.id))] ?? null;
    }
  }
  connected(c, p, boardPin) {
    const board = this.project.components.find(
      (c2) => isMcuKind(c2.kind) && c2.kind !== "yd-esp32-s3"
    );
    return !!board && this.netOf.get(this.key(c, p)) === this.netOf.get(this.key(board.id, boardPin));
  }
  supply(p, rail = "VCC", min = 2.3, max = 5.5) {
    return typeof p[rail] === "number" && p.GND === 0 && p[rail] >= min && p[rail] <= max;
  }
  evaluate(timeUs) {
    this.resolve();
    this.powered.clear();
    for (const c of this.project.components.filter(
      (c2) => ["stepper-driver", "ir-emitter"].includes(c2.kind)
    )) {
      const m = this.extensions.get(c.id);
      if (m) this.states[c.id] = m.update(timeUs, this.pins[c.id]);
    }
    for (const c of this.project.components.filter(
      (c2) => c2.kind === "h-bridge"
    )) {
      if (this.extensions.has(c.id)) continue;
      const p = this.pins[c.id], s = empty();
      const powered = this.supply(p, "VCC", 2.7, 5.5) && typeof p.VM === "number" && p.VM >= 0 && p.VM <= 48;
      const valid = ["EN", "IN1", "IN2"].every(
        (k) => typeof p[k] === "number" && (p[k] >= 0 && p[k] <= 0.8 || p[k] >= 2 && p[k] <= 5.5)
      );
      if (!powered || !valid)
        s.warnings.push(
          "H-bridge requires logic power, motor supply, ground and valid logic inputs"
        );
      const on = powered && valid && p.EN >= 2, a = on && p.IN1 >= 2, b = on && p.IN2 >= 2;
      s.outputs = {
        OUT1: powered ? a ? p.VM : 0 : null,
        OUT2: powered ? b ? p.VM : 0 : null
      };
      s.values = { enabled: on };
      this.states[c.id] = s;
    }
    this.resolve();
    for (const [id2, m] of this.models) {
      const c = this.project.components.find((c2) => c2.id === id2), p = this.pins[id2], s = empty();
      if (m instanceof Ds3231) {
        m.advance(timeUs);
        s.values = { ...m.snapshot() };
        if (this.supply(p)) this.powered.add(id2);
        else
          s.warnings.push(
            "RTC unpowered; I2C disconnected (backup calendar retained)"
          );
        if (this.target === "esp32s3")
          s.warnings.push("ESP32-S3 binding has no external I2C device hooks");
        if (this.powered.has(id2)) {
          const r = m.snapshot();
          s.outputs = {
            SQW: r.interruptLow ? 0 : r.sqw === 0 ? 0 : null,
            "32K": r.clock32k === 0 ? 0 : null
          };
        }
      } else if (m instanceof Mux4067) {
        const r = m.update(timeUs, p);
        s.values = { channel: r.channel, value: r.value, onOhms: r.onOhms };
        s.contacts = r.contacts;
        s.warnings = r.warnings;
      } else if (m instanceof RelayModule) {
        const r = m.update(timeUs, p);
        s.values = { energized: r.energized, currentA: r.currentA };
        s.contacts = r.contacts;
        s.warnings = r.warnings;
      } else if (m instanceof DcMotor) {
        const valid = typeof p.POS === "number" && typeof p.NEG === "number";
        const direct = this.project.components.some(
          (b) => isMcuKind(b.kind) && catalog[b.kind].pins.some(
            (pin2) => (pin2.electricalType === "bidirectional" || pin2.electricalType === "analog") && ["POS", "NEG"].some(
              (mp) => this.netOf.get(this.key(id2, mp)) === this.netOf.get(this.key(b.id, pin2.id))
            )
          )
        );
        if (direct)
          s.warnings.push(
            "Motor connected directly to MCU GPIO: drive refused; use a powered H-bridge"
          );
        if (!valid) s.warnings.push("Motor terminals floating or conflicting");
        const r = m.update(
          timeUs,
          valid && !direct ? p.POS - p.NEG : 0,
          c.properties.stalled === true
        );
        s.values = { ...r };
        if (Math.abs(r.currentA) > Number(catalog["h-bridge"].defaultProperties.maxCurrentA))
          s.warnings.push("Motor current exceeds default 3 A driver rating");
      } else if (m instanceof Ws2812) {
        if (this.supply(p, "VDD", 3.5, 5.5)) this.powered.add(id2);
        else {
          s.warnings.push("WS2812 needs VDD and GND");
          m.powerOff();
        }
        m.advance(timeUs);
        const r = m.snapshot();
        s.values = {
          colors: r.colors.join(","),
          currentA: r.currentA,
          errors: r.errors
        };
        if (this.target === "esp32s3")
          s.warnings.push(
            "WS2812 firmware decoding unavailable: S3 GPIO snapshots are not edge-accurate"
          );
      }
      this.states[id2] = s;
    }
    this.resolve();
    for (const [id2, m] of this.extensions) {
      const c = this.project.components.find((c2) => c2.id === id2);
      if (["stepper-driver", "ir-emitter"].includes(c.kind)) continue;
      const pins3 = { ...this.pins[id2] };
      let unsafe = false;
      if (c.kind === "stepper" || c.kind === "electromagnetic-switch") {
        const terminals = c.kind === "stepper" ? ["A1", "A2", "B1", "B2"] : ["COIL_POS", "COIL_NEG"];
        unsafe = this.project.components.some(
          (b) => isMcuKind(b.kind) && catalog[b.kind].pins.some(
            (p) => ["bidirectional", "analog"].includes(p.electricalType) && terminals.some(
              (t) => this.netOf.get(this.key(id2, t)) === this.netOf.get(this.key(b.id, p.id))
            )
          )
        );
        if (unsafe) for (const pin2 of terminals) pins3[pin2] = null;
      }
      this.states[id2] = m.update(timeUs, pins3);
      if (unsafe)
        this.states[id2].warnings.push(
          "Direct MCU GPIO coil power refused; use a powered driver"
        );
      if (this.target === "esp32s3" && [
        "hx711",
        "dht22",
        "servo",
        "stepper-driver",
        "arm-6dof",
        "universal-arm",
        "dobot-magician",
        "uarm-metal"
      ].includes(c.kind))
        this.states[id2].warnings.push(
          "S3 snapshot binding is not edge-accurate; timed firmware protocol support is unverified"
        );
    }
    this.resolve();
    for (const c of this.project.components.filter(
      (c2) => ["voltmeter", "ammeter"].includes(c2.kind)
    )) {
      const s = empty(), a = this.pinVoltage(c.id, "POS"), b = this.pinVoltage(c.id, "NEG"), v = a === null || b === null ? null : a - b, value = c.kind === "voltmeter" ? v : this.dcCurrents[c.id] ?? null, range = Number(
        c.properties[c.kind === "voltmeter" ? "rangeV" : "rangeA"] ?? (c.kind === "voltmeter" ? 60 : 10)
      );
      s.values = {
        status: value === null ? "floating-or-conflicting" : Math.abs(value) > range ? "overrange" : "ok",
        [c.kind === "voltmeter" ? "voltageV" : "currentA"]: value
      };
      if (value === null)
        s.warnings.push(
          "Meter terminals floating, conflicting, invalid shunt or DC solver bound exceeded"
        );
      if (value !== null && Math.abs(value) > range)
        s.warnings.push("Meter exceeds configured measurement range");
      s.warnings.push(...this.dcIssues);
      this.states[c.id] = s;
    }
  }
  /** @brief Advance from real CPU timestamps. AVR transitions are instruction-cycle accurate. */
  advance(timeUs, gpio, transitions = []) {
    checkTime(timeUs, this.time);
    if (this.target !== "esp32s3")
      for (const e of transitions) {
        const at = e.cycle / 16;
        if (at < this.time || at > timeUs) continue;
        this.evaluate(at);
        this.gpio = { ...this.gpio, [e.pin]: e.level };
        this.evaluate(at);
        if (e.level !== null) {
          for (const [id2, m] of this.models)
            if (m instanceof Ws2812 && (this.wsChains.get(id2) ?? [id2]).every(
              (c) => this.powered.has(c)
            ) && this.connected(this.wsSources.get(id2) ?? id2, "DIN", e.pin)) {
              const source = this.wsSources.get(id2) ?? id2;
              const voltage = this.pinVoltage(source, "DIN"), vdd = this.pinVoltage(source, "VDD");
              const valid = voltage !== null && vdd !== null && voltage >= 0 && voltage <= vdd && (e.level === 1 ? voltage >= 0.7 * vdd : voltage <= 0.3 * vdd);
              if (valid) m.edge(at, e.level);
              else m.powerOff();
            }
        }
      }
    this.gpio = { ...gpio };
    this.evaluate(timeUs);
    this.time = timeUs;
    return structuredClone(this.states);
  }
  /** @brief Address an actual wired and powered Uno I2C RTC; otherwise NACK. */
  i2cWrite(address, bytes) {
    const matches = [...this.models].filter(
      ([id2, m]) => m instanceof Ds3231 && m.address === address && this.powered.has(id2) && this.connected(id2, "SDA", boardI2cPins(this.target).sda) && this.connected(id2, "SCL", boardI2cPins(this.target).scl)
    );
    const ack = matches.length === 1;
    this.transactions.push({
      timeUs: this.time,
      address,
      direction: bytes.length ? "write" : "address",
      bytes: [...bytes],
      ack
    });
    if (this.transactions.length > 100) this.transactions.shift();
    if (!ack) return false;
    if (!bytes.length) return true;
    return matches[0][1].write(address, bytes);
  }
  /** @brief Read from the selected RTC using its current register pointer. */
  i2cRead(address, count) {
    for (const [id2, m] of this.models)
      if (m instanceof Ds3231 && m.address === address && this.powered.has(id2) && this.connected(id2, "SDA", boardI2cPins(this.target).sda) && this.connected(id2, "SCL", boardI2cPins(this.target).scl)) {
        const bytes = m.read(address, count);
        this.transactions.push({
          timeUs: this.time,
          address,
          direction: "read",
          bytes,
          ack: true
        });
        if (this.transactions.length > 100) this.transactions.shift();
        return bytes;
      }
    return [];
  }
  /** @brief Inspect a resolved terminal voltage; null means floating or conflicting drivers. */
  pinVoltage(componentId, pinId) {
    return this.pins[componentId]?.[pinId] ?? null;
  }
  /** @brief Absolute time already consumed by this host. */
  get timeMicros() {
    return this.time;
  }
  /** @brief Resolve wired MCU inputs, including contact/multiplexer/RTC paths. Null denotes floating/ambiguous. */
  inputLevels() {
    const board = this.project.components.find((c) => isMcuKind(c.kind));
    if (!board) return {};
    const result = {}, threshold = board.kind !== "yd-esp32-s3" ? 3 : 2;
    for (const pin2 of catalog[board.kind].pins) {
      const gpio = board.kind !== "yd-esp32-s3" ? /^(D\d+|A\d+)$/.test(pin2.id) && pin2.electricalType !== "adc-only-unimplemented" ? pin2.id : null : ydBoard.pins.find((p) => p.id === pin2.id)?.gpio;
      if (gpio === null || gpio === void 0) continue;
      if (!this.project.wires.some(
        (w) => [w.from, w.to].some(
          (e) => e.componentId === board.id && e.pinId === pin2.id
        )
      ))
        continue;
      const v = this.pinVoltage(board.id, pin2.id);
      result[board.kind !== "yd-esp32-s3" ? String(gpio) : `GPIO${gpio}`] = v === null ? null : v <= 0.8 ? 0 : v >= threshold ? 1 : null;
    }
    return result;
  }
  /** @brief Apply an external switch state without replacing device instances or their clock state. */
  setButton(id2, pressed) {
    const c = this.project.components.find(
      (c2) => c2.id === id2 && (c2.kind === "switch" || c2.kind === "tactile-switch")
    );
    if (c) c.properties = { ...c.properties, pressed };
  }
  /** @brief LED evaluation includes powered driver/contact paths resolved by the component host. */
  ledStates() {
    return Object.fromEntries(
      this.project.components.filter((c) => c.kind === "led").map((c) => {
        const a = this.pinVoltage(c.id, "A"), k = this.pinVoltage(c.id, "K");
        return [c.id, a === null || k === null ? null : a - k > 1.5];
      })
    );
  }
  /** @brief Return live closed device and switch contacts for electrical projection and instrument interlocks. */
  contactWires() {
    const behavioral = Object.entries(this.states).flatMap(
      ([id2, s]) => s.contacts.map(([a, b], i) => ({
        id: `model-${id2}-${i}`,
        from: { componentId: id2, pinId: a },
        to: { componentId: id2, pinId: b },
        color: "#000000",
        label: ""
      }))
    );
    const switches = this.project.components.flatMap((component) => {
      const pairs = component.kind === "switch" && component.properties.pressed === true ? [["1", "2"]] : component.kind === "tactile-switch" ? [
        ["1A", "1B"],
        ["2A", "2B"],
        ...component.properties.pressed === true ? [["1A", "2A"]] : []
      ] : [];
      return pairs.map(([from, to], index) => ({
        id: `contact-${component.id}-${index}`,
        from: { componentId: component.id, pinId: from },
        to: { componentId: component.id, pinId: to },
        color: "#000000",
        label: ""
      }));
    });
    return [...behavioral, ...switches];
  }
};

// ../simulab-frontend/src/circuit/editing.ts
function connect(project, from, to) {
  if (!hasEndpoint(project, from) || !hasEndpoint(project, to))
    throw new Error("Connect to a defined component pin.");
  const a = endpointKey(from), b = endpointKey(to);
  if (a === b) throw new Error("A wire needs two distinct endpoints.");
  if (project.wires.some(
    (w) => endpointKey(w.from) === a && endpointKey(w.to) === b || endpointKey(w.from) === b && endpointKey(w.to) === a
  ))
    throw new Error("These pins are already connected by a wire.");
  const wire = {
    id: crypto.randomUUID(),
    from: { ...from },
    to: { ...to },
    color: "#5bbfa8",
    label: ""
  };
  return { ...project, wires: [...project.wires, wire] };
}

// ../simulab-frontend/src/circuit/project.ts
var fail2 = (message) => {
  throw new Error(`Invalid circuit: ${message}`);
};
var object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) ? v : fail2("expected an object.");
var text2 = (v, max = 200) => typeof v === "string" && v.length <= max ? v : fail2("invalid text field.");
var id = (v) => {
  const s = text2(v, 100);
  return s.length && /^[\w.-]+$/.test(s) ? s : fail2("invalid identifier.");
};
var coordinate = (v) => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1e5 ? v : fail2("coordinate out of range.");
var endpoint = (v) => {
  const e = object(v);
  return { componentId: id(e.componentId), pinId: id(e.pinId) };
};
function parseProject(json) {
  if (json.length > 2e6) fail2("file exceeds 2 MB character limit.");
  const root = object(JSON.parse(json));
  if (!["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"].includes(
    String(root.schemaVersion)
  ))
    fail2("unsupported schema version; expected 1.0.0 through 1.4.0.");
  if (!Array.isArray(root.components) || root.components.length > 1e3 || !Array.isArray(root.wires) || root.wires.length > 5e3)
    fail2("component/wire limits exceeded or invalid arrays.");
  const ids = /* @__PURE__ */ new Set();
  const components = root.components.map(
    (raw) => {
      const c = object(raw);
      const componentId = id(c.id);
      if (ids.has(componentId)) fail2("duplicate component ID.");
      ids.add(componentId);
      const kind = text2(c.kind);
      if (!Object.hasOwn(catalog, kind)) fail2("unknown component type.");
      if (["serial-monitor", "debugger"].includes(kind) && root.schemaVersion !== "1.4.0")
        fail2("Instruments require schema 1.4.0.");
      if (kind === "yd-esp32-s3" && root.schemaVersion === "1.0.0")
        fail2("YD board requires circuit schema 1.1.0.");
      if ([
        "ds3231",
        "mux4067",
        "dc-motor",
        "ws2812",
        "relay",
        "h-bridge"
      ].includes(kind) && !["1.2.0", "1.3.0", "1.4.0"].includes(String(root.schemaVersion)))
        fail2("Device models require schema 1.2.0.");
      if (![
        "uno",
        "yd-esp32-s3",
        "led",
        "resistor",
        "switch",
        "junction",
        "ds3231",
        "mux4067",
        "dc-motor",
        "ws2812",
        "relay",
        "h-bridge"
      ].includes(kind) && !["1.3.0", "1.4.0"].includes(String(root.schemaVersion)))
        fail2("Expanded models require schema 1.3.0.");
      const position = object(c.position);
      const props = object(c.properties);
      if (Object.keys(props).length > 50) fail2("too many properties.");
      const properties = {};
      for (const [key, value] of Object.entries(props)) {
        if (key.length > 100 || ["__proto__", "prototype", "constructor"].includes(key))
          fail2("invalid property name.");
        if (typeof value === "string") properties[key] = text2(value, 1e3);
        else if (typeof value === "boolean") properties[key] = value;
        else if (typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e12)
          properties[key] = value;
        else fail2("invalid property value.");
      }
      validateModelProperties(kind, properties);
      if (typeof c.rotation !== "number" || ![0, 90, 180, 270].includes(c.rotation))
        fail2("rotation must be 0, 90, 180, or 270.");
      return {
        id: componentId,
        kind,
        label: text2(c.label),
        position: { x: coordinate(position.x), y: coordinate(position.y) },
        rotation: c.rotation,
        properties
      };
    }
  );
  const project = {
    schemaVersion: root.schemaVersion,
    name: text2(root.name),
    components,
    wires: []
  };
  const wireIds = /* @__PURE__ */ new Set();
  const pairs = /* @__PURE__ */ new Set();
  project.wires = root.wires.map((raw) => {
    const w = object(raw);
    const wireId = id(w.id);
    if (wireIds.has(wireId)) fail2("duplicate wire ID.");
    wireIds.add(wireId);
    const from = endpoint(w.from), to = endpoint(w.to);
    if ([from, to].some((e) => ["DEBUG", "CONSOLE"].includes(e.pinId)) && root.schemaVersion !== "1.4.0")
      fail2("Virtual instrument endpoints require schema 1.4.0.");
    if (!hasEndpoint(project, from) || !hasEndpoint(project, to))
      fail2("wire references an unknown pin.");
    const a = endpointKey(from), b = endpointKey(to);
    const pair = JSON.stringify([a, b].sort());
    if (a === b || pairs.has(pair)) fail2("self wire or duplicate connection.");
    pairs.add(pair);
    const color = text2(w.color, 9);
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) fail2("wire color must use #RRGGBB.");
    return { id: wireId, from, to, color, label: text2(w.label) };
  });
  return project;
}
function createSampleProject() {
  const uno = {
    ...createComponent("uno", { x: 80, y: 100 }),
    id: "uno-1",
    label: "Arduino Uno"
  };
  const resistor = {
    ...createComponent("resistor", { x: 520, y: 80 }),
    id: "resistor-1",
    label: "R1"
  };
  const led = {
    ...createComponent("led", { x: 780, y: 80 }),
    id: "led-1",
    label: "LED1"
  };
  const button = {
    ...createComponent("switch", { x: 520, y: 320 }),
    id: "switch-1",
    label: "SW1"
  };
  let p = {
    schemaVersion: "1.0.0",
    name: "Untitled circuit",
    components: [uno, resistor, led, button],
    wires: []
  };
  for (const [a, ap, b, bp] of [
    ["uno-1", "D13", "resistor-1", "1"],
    ["resistor-1", "2", "led-1", "A"],
    ["led-1", "K", "uno-1", "GND"],
    ["switch-1", "1", "uno-1", "D2"],
    ["switch-1", "2", "uno-1", "GND"]
  ])
    p = connect(
      p,
      { componentId: a, pinId: ap },
      { componentId: b, pinId: bp }
    );
  return p;
}

// ../simulab-frontend/src/circuit/categories.ts
function componentCategory(kind) {
  if (isMcuKind(kind)) return "Microcontroller";
  if (["serial-monitor", "debugger"].includes(kind)) return "Instrument";
  if (["voltmeter", "ammeter"].includes(kind)) return "Meter";
  if ([
    "arm-6dof",
    "universal-arm",
    "dobot-magician",
    "uarm-metal",
    "conveyor",
    "robotic-car"
  ].includes(kind))
    return "Robotics";
  if (["dht22", "hx711", "ir-detector"].includes(kind)) return "Sensor";
  if (["dc-motor", "stepper", "servo", "led", "ws2812", "ir-emitter"].includes(
    kind
  ))
    return "Actuator";
  if ([
    "junction",
    "resistor",
    "switch",
    "tactile-switch",
    "electromagnetic-switch"
  ].includes(kind))
    return "Connection";
  return "Module";
}

// ../simulab-frontend/src/circuit/yd-example.ts
function createYdExample() {
  const board = {
    ...createComponent("yd-esp32-s3", { x: 200, y: 0 }),
    id: "yd-1",
    label: "YD1"
  }, led = {
    ...createComponent("led", { x: -170, y: 150 }),
    id: "led-1",
    label: "LED1"
  }, resistor = {
    ...createComponent("resistor", { x: -410, y: 150 }),
    id: "resistor-1",
    label: "R1"
  }, button = {
    ...createComponent("switch", { x: -200, y: 420 }),
    id: "switch-1",
    label: "SW1"
  };
  let p = {
    schemaVersion: "1.1.0",
    name: "YD ESP32-S3 GPIO4 lab",
    components: [board, led, resistor, button],
    wires: []
  };
  for (const [a, ap, b, bp] of [
    ["yd-1", "P1.4", "resistor-1", "1"],
    ["resistor-1", "2", "led-1", "A"],
    ["led-1", "K", "yd-1", "P1.22"],
    ["yd-1", "P1.5", "switch-1", "1"],
    ["switch-1", "2", "yd-1", "P2.22"]
  ])
    p = connect(
      p,
      { componentId: a, pinId: ap },
      { componentId: b, pinId: bp }
    );
  return p;
}

// ../simulab-frontend/src/circuit/components-example.ts
function createComponentsExample() {
  const parts = [
    ["uno", "uno", 40, 140],
    ["rtc", "ds3231", 440, 20],
    ["mux", "mux4067", 440, 320],
    ["relay", "relay", 760, 20],
    ["driver", "h-bridge", 760, 320],
    ["motor", "dc-motor", 1080, 320],
    ["rgb", "ws2812", 1080, 20]
  ];
  let p = {
    schemaVersion: "1.2.0",
    name: "Uno component laboratory",
    components: parts.map(([id2, kind, x, y]) => ({
      ...createComponent(kind, { x, y }),
      id: id2
    })),
    wires: []
  };
  const wire = (a, ap, b, bp) => {
    p = connect(
      p,
      { componentId: a, pinId: ap },
      { componentId: b, pinId: bp }
    );
  };
  for (const id2 of ["rtc", "mux", "relay", "driver", "rgb"]) {
    wire("uno", "5V", id2, id2 === "rgb" ? "VDD" : "VCC");
    wire("uno", "GND", id2, "GND");
  }
  wire("uno", "A4", "rtc", "SDA");
  wire("uno", "A5", "rtc", "SCL");
  for (const [pin2, target] of [
    ["D8", "S0"],
    ["D9", "S1"],
    ["D10", "S2"],
    ["D12", "S3"],
    ["GND", "EN"],
    ["A0", "COM"],
    ["3V3", "C0"],
    ["GND", "C1"]
  ])
    wire("uno", pin2, "mux", target);
  for (const [pin2, target] of [
    ["D4", "IN1"],
    ["D5", "IN2"],
    ["D6", "EN"],
    ["5V", "VM"]
  ])
    wire("uno", pin2, "driver", target);
  wire("driver", "OUT1", "motor", "POS");
  wire("driver", "OUT2", "motor", "NEG");
  wire("uno", "D7", "relay", "IN");
  wire("uno", "GND", "relay", "COM");
  wire("relay", "NO", "uno", "D2");
  wire("uno", "D3", "rgb", "DIN");
  return p;
}

// ../simulab-frontend/src/ide/boardStarter.ts
var blankSketch = "void setup() {\n}\n\nvoid loop() {\n}\n";
var s3Sketch = `/** @brief ESP32-S3 simulator GPIO4 and Serial Blink demo.
 * @details Watch the GPIO4 pin square, or connect an external LED through a resistor.
 * Onboard RGB uses GPIO48; its RMT waveform visualization is unavailable in this simulator.
 */
void setup() {
  pinMode(4, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(4, HIGH);
  Serial.println("GPIO4 HIGH");
  delay(500);
  digitalWrite(4, LOW);
  Serial.println("GPIO4 LOW");
  delay(500);
}
`;
var avrBlink = `/** @brief Blink the board's onboard D13 LED using real compiled Arduino firmware. */
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("LED ON");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("LED OFF");
  delay(500);
}
`;
function controllerStarter(kind) {
  const board = kind === "yd-esp32-s3" ? "esp32s3" : kind;
  return { board, content: board === "esp32s3" ? s3Sketch : avrBlink };
}
function boardStarter(circuit) {
  const controllers = circuit.components.filter((c) => isMcuKind(c.kind));
  if (controllers.length !== 1) return void 0;
  const controller = controllers[0];
  return {
    identity: `${controller.id}:${controller.kind}`,
    ...controllerStarter(controller.kind)
  };
}

// ../simulab-frontend/src/ide/workspace.ts
var boardProfiles = {
  uno: { name: "Arduino Uno", target: "uno" },
  nano: { name: "Arduino Nano", target: "nano" },
  mega2560: { name: "Arduino Mega2560", target: "mega2560" },
  esp32: { name: "ESP32 DevKit (build/upload)", target: null },
  esp32s3: { name: "ESP32-S3 DevKit", target: "esp32s3" },
  "yd-n16r8": {
    name: "YD ESP32-S3 N16R8 (compatible compile profile)",
    target: "esp32s3"
  }
};
function newWorkspace(circuit) {
  const starter = boardStarter(circuit);
  return {
    version: "1.0.0",
    circuit,
    board: starter?.board ?? "uno",
    files: [{ name: "sketch.ino", content: starter?.content ?? blankSketch }],
    activeFile: "sketch.ino",
    activeTab: "hardware",
    breakpoints: {}
  };
}
function parseWorkspace(json) {
  if (json.length > 31e5) throw new Error("Workspace exceeds 3 MB");
  const w = JSON.parse(json);
  if (!w || w.version !== "1.0.0" || !Object.hasOwn(boardProfiles, w.board) || !["hardware", "code", "debugger", "serial"].includes(w.activeTab) || !Array.isArray(w.files) || !w.files.length || w.files.length > 32)
    throw new Error("Invalid IDE workspace");
  const names = /* @__PURE__ */ new Set();
  let size = 0;
  for (const f of w.files) {
    if (!f || !/^[A-Za-z][A-Za-z0-9_-]{0,63}\.(ino|h|hpp|cpp|c)$/.test(f.name) || /^(con|prn|aux|nul|com\d|lpt\d)\./i.test(f.name) || names.has(f.name.toLowerCase()) || typeof f.content !== "string")
      throw new Error("Invalid source file");
    names.add(f.name.toLowerCase());
    size += f.content.length;
    if (f.cursor && (!Number.isSafeInteger(f.cursor.lineNumber) || f.cursor.lineNumber < 1 || !Number.isSafeInteger(f.cursor.column) || f.cursor.column < 1))
      throw new Error("Invalid cursor");
  }
  if (size > 1e6 || !names.has("sketch.ino") || !w.files.some((f) => f.name === w.activeFile))
    throw new Error("Invalid source project");
  if (!w.breakpoints || typeof w.breakpoints !== "object" || Object.entries(w.breakpoints).some(
    ([f, lines]) => !w.files.some((s) => s.name === f) || !Array.isArray(lines) || lines.length > 1e3 || lines.some((n) => !Number.isSafeInteger(n) || n < 1)
  ))
    throw new Error("Invalid breakpoints");
  return {
    ...w,
    activeTab: "hardware",
    circuit: parseProject(JSON.stringify(w.circuit))
  };
}

// ../simulab-frontend/src/simulation/projection.ts
function projectSignals(project, gpio) {
  const result = {
    ledStates: Object.fromEntries(
      project.components.filter((c) => c.kind === "led").map((c) => [c.id, null])
    ),
    issues: []
  };
  const electrical = electricalCircuit(project);
  project = electrical.project;
  result.issues.push(...electrical.issues);
  const boards = project.components.filter((c) => isMcuKind(c.kind));
  if (boards.length !== 1) {
    if (project.components.length)
      result.issues.push(
        boards.every((c) => c.kind === "uno") ? "Exactly one Arduino Uno is supported for digital signal projection." : "Exactly one supported MCU board is required for digital signal projection."
      );
    return result;
  }
  const parent = /* @__PURE__ */ new Map();
  for (const component of project.components)
    for (const pin2 of componentPins(component.kind)) {
      const key = endpointKey({ componentId: component.id, pinId: pin2.id });
      parent.set(key, key);
    }
  const root = (key) => {
    let current = key;
    while (parent.get(current) !== current) {
      current = parent.get(current);
    }
    let node = key;
    while (parent.get(node) !== current) {
      const next = parent.get(node);
      parent.set(node, current);
      node = next;
    }
    return current;
  };
  const union = (from, to) => {
    const a = endpointKey(from), b = endpointKey(to);
    if (!parent.has(a) || !parent.has(b)) {
      result.issues.push("A wire references an unknown endpoint.");
      return;
    }
    const ra = root(a), rb = root(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const wire of project.wires) union(wire.from, wire.to);
  for (const component of project.components) {
    if (component.kind === "resistor") {
      const resistance = component.properties.resistanceOhms ?? catalog.resistor.defaultProperties.resistanceOhms;
      if (typeof resistance === "number" && Number.isFinite(resistance) && resistance > 0)
        union(
          { componentId: component.id, pinId: "1" },
          { componentId: component.id, pinId: "2" }
        );
      else
        result.issues.push(
          `Resistor ${component.label} needs a positive finite resistance; its digital path is open.`
        );
    }
    if (component.kind === "tactile-switch") {
      union(
        { componentId: component.id, pinId: "1A" },
        { componentId: component.id, pinId: "1B" }
      );
      union(
        { componentId: component.id, pinId: "2A" },
        { componentId: component.id, pinId: "2B" }
      );
      if (component.properties.pressed === true)
        union(
          { componentId: component.id, pinId: "1A" },
          { componentId: component.id, pinId: "2A" }
        );
    }
    if (component.kind === "switch" && component.properties.pressed === true)
      union(
        { componentId: component.id, pinId: "1" },
        { componentId: component.id, pinId: "2" }
      );
  }
  for (const component of project.components.filter(
    (c) => c.kind === "yd-esp32-s3"
  ))
    for (const group of ydBoard.internalNets)
      for (const pinId of group.pinIds.slice(1))
        union(
          { componentId: component.id, pinId: group.pinIds[0] },
          { componentId: component.id, pinId }
        );
  const drivers = /* @__PURE__ */ new Map();
  const board = boards[0];
  const drive = (pinId, value) => {
    const key = endpointKey({ componentId: board.id, pinId });
    if (!parent.has(key)) return;
    const net = root(key);
    if (!drivers.has(net)) drivers.set(net, /* @__PURE__ */ new Set());
    drivers.get(net).add(value);
  };
  if (board.kind !== "yd-esp32-s3") {
    drive("5V", 1);
    drive("GND", 0);
    for (const pin2 of catalog[board.kind].pins) {
      if (!/^(D\d+|A\d+)$/.test(pin2.id) || pin2.electricalType === "adc-only-unimplemented")
        continue;
      const level2 = gpio[pin2.id];
      if (level2 === 0 || level2 === 1) drive(pin2.id, level2);
    }
  } else {
    for (const pin2 of ydBoard.pins) {
      if (pin2.electricalType === "ground") drive(pin2.id, 0);
      if (pin2.electricalType === "power") drive(pin2.id, 1);
      if (pin2.gpio === null) continue;
      if (!supportsGPIOOutput(
        pin2,
        String(board.properties.memoryVariant ?? "unconfirmed")
      )) {
        if (project.wires.some(
          (w) => [w.from, w.to].some(
            (e) => e.componentId === board.id && e.pinId === pin2.id
          )
        ))
          result.issues.push(
            `GPIO${pin2.gpio} is reserved by the selected or unconfirmed memory module.`
          );
        continue;
      }
      const level2 = gpio[`GPIO${pin2.gpio}`];
      if (level2 === 0 || level2 === 1) drive(pin2.id, level2);
    }
  }
  const conflict = /* @__PURE__ */ new Set();
  for (const [net, levels] of drivers)
    if (levels.size > 1) {
      conflict.add(net);
      result.issues.push(
        "Digital driver conflict: HIGH and LOW sources share a conductive path. No analog/current solution is available."
      );
    }
  const level = (componentId, pinId) => {
    const net = root(endpointKey({ componentId, pinId }));
    if (conflict.has(net)) return null;
    const levels = drivers.get(net);
    return levels?.size === 1 ? [...levels][0] : null;
  };
  for (const component of project.components)
    if (component.kind === "led") {
      const anode = level(component.id, "A"), cathode = level(component.id, "K");
      result.ledStates[component.id] = anode === null || cathode === null ? null : anode === 1 && cathode === 0;
    }
  return result;
}

// ../simulab-frontend/src/simulation/buttonInputs.ts
function buttonInputs(project) {
  const board = project.components.find((c) => isMcuKind(c.kind));
  if (!board) return {};
  const switches = project.components.filter((c) => ["switch", "tactile-switch"].includes(c.kind));
  const permanent = switches.filter((c) => c.kind === "tactile-switch").flatMap((c) => [["1A", "1B"], ["2A", "2B"]].map(([a, b], i) => ({ id: `pair-${c.id}-${i}`, from: { componentId: c.id, pinId: a }, to: { componentId: c.id, pinId: b }, color: "#000000", label: "" })));
  const open = buildNets({ ...project, wires: [...project.wires, ...permanent] });
  const closed = buildNets({
    ...project,
    wires: [
      ...project.wires,
      ...permanent,
      ...switches.filter((c) => c.properties.pressed === true).map((c) => ({
        id: `contact-${c.id}`,
        from: { componentId: c.id, pinId: c.kind === "tactile-switch" ? "1A" : "1" },
        to: { componentId: c.id, pinId: c.kind === "tactile-switch" ? "2A" : "2" },
        color: "#000000",
        label: ""
      }))
    ]
  });
  const result = {};
  const avr = board.kind !== "yd-esp32-s3";
  const pins3 = avr ? boardPins(board.kind).filter((p) => p.digital).map((p) => ({ ...p, gpio: 0 })) : ydBoard.pins;
  for (const pin2 of pins3) {
    if (pin2.gpio === null || !avr && [35, 36, 37].includes(pin2.gpio)) continue;
    const wired = open.find(
      (n) => n.endpoints.some((e) => e.componentId === board.id && e.pinId === pin2.id)
    );
    if (!wired?.endpoints.some(
      (e) => switches.some((c) => c.id === e.componentId)
    ))
      continue;
    const net = closed.find(
      (n) => n.endpoints.some((e) => e.componentId === board.id && e.pinId === pin2.id)
    );
    const low = net?.endpoints.some(
      (e) => e.componentId === board.id && (avr ? e.pinId === "GND" : ydBoard.pins.find((p) => p.id === e.pinId)?.electricalType === "ground")
    );
    result[avr ? pin2.id : `GPIO${pin2.gpio}`] = !low;
  }
  return result;
}

// ../simulab-frontend/src/simulation/controllerPinStates.ts
function controllerPinStates(project, voltage) {
  const result = /* @__PURE__ */ Object.create(null);
  for (const part of project.components) {
    if (!isMcuKind(part.kind)) continue;
    const highThreshold = part.kind === "yd-esp32-s3" ? 2 : 3;
    const memoryVariant = String(
      part.properties.memoryVariant ?? "unconfirmed"
    );
    result[part.id] = Object.fromEntries(
      catalog[part.kind].pins.map((pin2) => {
        const boardPin = part.kind === "yd-esp32-s3" ? ydBoard.pins.find((entry) => entry.id === pin2.id) : void 0;
        const reserved = boardPin?.restrictions.includes(
          "reserved-on-octal-memory-variants"
        ) && (memoryVariant === "N16R8" || !Object.hasOwn(ydBoard.memory.profiles, memoryVariant));
        if (pin2.electricalType === "adc-only-unimplemented" || reserved)
          return [pin2.id, null];
        const value = voltage(part.id, pin2.id);
        const level = typeof value !== "number" || !Number.isFinite(value) || value < 0 ? null : value <= 0.8 ? 0 : value >= highThreshold ? 1 : null;
        return [pin2.id, level];
      })
    );
  }
  return result;
}

// ../simulab-frontend/src/simulation/targets.ts
function simulationTarget(project) {
  const boards = project.components.filter((c) => isMcuKind(c.kind));
  return boards.length > 1 ? "multiple" : boards.length === 0 ? "none" : boardTarget(boards[0].kind);
}

// ../simulab-frontend/src/instruments/types.ts
var InstrumentRequestError = class extends Error {
};
var isInstrument = (kind) => kind === "serial-monitor" || kind === "debugger";

// ../simulab-frontend/src/instruments/connections.ts
function resolveInstrument(project, componentId, contacts = [], gpio = {}) {
  const result = {
    receive: false,
    transmit: false,
    debug: false,
    console: false,
    issues: []
  };
  const tool = project.components.find((c) => c.id === componentId);
  if (!tool || !isInstrument(tool.kind)) {
    result.issues.push("Unknown instrument.");
    return result;
  }
  const boards = project.components.filter((c) => isMcuKind(c.kind));
  if (boards.length !== 1) {
    result.issues.push("Connect to exactly one supported MCU in this circuit.");
    return result;
  }
  const board = boards[0];
  result.boardId = board.id;
  result.target = boardTarget(board.kind);
  const byId = new Map(project.components.map((c) => [c.id, c]));
  const nets = buildNets({
    ...project,
    wires: [...project.wires, ...contacts]
  });
  const net = (pin2) => nets.find(
    (n) => n.endpoints.some((e) => e.componentId === tool.id && e.pinId === pin2)
  )?.endpoints ?? [];
  const isJunction = (e) => byId.get(e.componentId)?.kind === "junction" && e.pinId === "J";
  const boardPin = (e, id2) => e.componentId === board.id && e.pinId === id2;
  const toolPin = (e, id2) => e.componentId === tool.id && e.pinId === id2;
  const contactPin = (e) => {
    const kind = byId.get(e.componentId)?.kind;
    return kind === "switch" || kind === "tactile-switch" || ["relay", "electromagnetic-switch"].includes(kind ?? "") && ["COM", "NO", "NC"].includes(e.pinId);
  };
  const strictService = (pin2) => {
    const members = net(pin2);
    return members.some((e) => boardPin(e, pin2)) && members.every((e) => isJunction(e) || boardPin(e, pin2) || toolPin(e, pin2));
  };
  if (tool.kind === "debugger") {
    result.debug = strictService("DEBUG");
    if (!result.debug)
      result.issues.push(
        "Connect DEBUG to the MCU's virtual DEBUG port; keep this service separate from electrical pins."
      );
    return result;
  }
  if (board.kind === "yd-esp32-s3") {
    result.console = strictService("CONSOLE");
    result.receive = result.transmit = result.console;
    if (!result.console)
      result.issues.push(
        "Connect CONSOLE to the S3 virtual CONSOLE port. GPIO43/44 UART routing is unavailable in this adapter."
      );
    return result;
  }
  const groundMembers = net("GND");
  const ground = groundMembers.some((e) => boardPin(e, "GND")) && groundMembers.every((e) => {
    const c = byId.get(e.componentId);
    const type = c && componentPins(c.kind).find((p) => p.id === e.pinId)?.electricalType;
    if (!c || !type || type.startsWith("virtual-") || type === "power" || type === "power-input")
      return false;
    if (isInstrument(c.kind)) return e.pinId === "GND" && type === "ground";
    if (isMcuKind(c.kind)) {
      if (boardPin(e, "GND")) return true;
      if (["D0", "D1"].includes(e.pinId) || gpio[e.pinId] === 1) return false;
      return [
        "bidirectional",
        "analog",
        "input",
        "adc-only-unimplemented"
      ].includes(type);
    }
    return isJunction(e) || contactPin(e) || [
      "ground",
      "ground-input",
      "passive",
      "input",
      "analog",
      "bidirectional"
    ].includes(type);
  });
  const rx = net("RX"), tx = net("TX");
  result.receive = ground && rx.some((e) => boardPin(e, "D1")) && rx.every(
    (e) => isJunction(e) || contactPin(e) || boardPin(e, "D1") || byId.get(e.componentId)?.kind === "serial-monitor" && e.pinId === "RX"
  );
  result.transmit = ground && tx.some((e) => boardPin(e, "D0")) && tx.every(
    (e) => isJunction(e) || contactPin(e) || boardPin(e, "D0") || toolPin(e, "TX")
  );
  if (!ground)
    result.issues.push(
      "Connect GND to the same MCU ground; UART0 signals, power sources and HIGH output drivers must not share this ground net."
    );
  if (!result.receive)
    result.issues.push(
      "Connect RX to MCU D1/TX (UART0), with no conflicting signal drivers."
    );
  if (!result.transmit)
    result.issues.push(
      "Connect TX to MCU D0/RX (UART0), with one terminal transmitter per net."
    );
  return result;
}
function previewInstrumentState(project, componentId) {
  const tool = project.components.find((c) => c.id === componentId);
  if (!tool || !isInstrument(tool.kind)) return void 0;
  return {
    componentId,
    kind: tool.kind,
    connection: resolveInstrument(project, componentId),
    log: ""
  };
}

// ../simulab-frontend/src/instruments/session.ts
var InstrumentSession = class {
  constructor(project, limit = 16384) {
    this.project = project;
    this.limit = limit;
    for (const c of project.components)
      if (isInstrument(c.kind))
        this.entries[c.id] = previewInstrumentState(project, c.id);
  }
  project;
  limit;
  entries = /* @__PURE__ */ Object.create(null);
  status = "ready";
  gpio = {};
  get states() {
    return this.entries;
  }
  /** @brief Capture already-drained genuine UART bytes and capability-provided CPU state. */
  capture(snapshot, debug, contacts = []) {
    this.status = snapshot.state;
    this.gpio = snapshot.gpio;
    for (const [id2, state] of Object.entries(this.entries)) {
      const connection = resolveInstrument(
        this.project,
        id2,
        contacts,
        this.gpio
      );
      this.entries[id2] = {
        ...state,
        connection,
        log: state.kind === "serial-monitor" && connection.receive ? (state.log + snapshot.serial).slice(-this.limit) : state.log,
        debug: connection.debug && connection.target !== "esp32s3" ? debug : void 0,
        cycles: connection.debug ? snapshot.cycles : void 0,
        timeMicros: connection.debug || connection.receive ? snapshot.timeMicros : void 0,
        gpio: connection.debug ? snapshot.gpio : void 0
      };
    }
    return structuredClone(this.entries);
  }
  /** @brief Validate every instrument action at the CPU host boundary before causing any runtime side effect.
   * @throws Error for bad wiring, unsupported operations, invalid state or oversized input. The caller reports this per instrument without stopping the CPU.
   */
  perform(componentId, action, text3, runtime, contacts = []) {
    const state = this.entries[componentId];
    if (!state) throw new InstrumentRequestError("Unknown instrument.");
    if (!["send", "clear", "step", "pause", "resume", "reset", "stop"].includes(
      action
    ))
      throw new InstrumentRequestError("Unsupported instrument action.");
    const connection = resolveInstrument(
      this.project,
      componentId,
      contacts,
      this.gpio
    );
    if (action === "clear") {
      state.log = "";
      state.error = void 0;
      return;
    }
    if (action === "send") {
      if (state.kind !== "serial-monitor" || !connection.transmit)
        throw new InstrumentRequestError(
          "Connect the instrument transmit wiring before sending firmware input."
        );
      if (this.status !== "running")
        throw new InstrumentRequestError(
          "Run the MCU before sending serial input."
        );
      if (typeof text3 !== "string" || new TextEncoder().encode(text3).length > 4095)
        throw new InstrumentRequestError("Serial input exceeds 4095 bytes.");
      try {
        runtime.uartInput(
          new TextEncoder().encode(text3 + (connection.console ? "\r" : "\n"))
        );
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "INPUT_LIMIT")
          throw new InstrumentRequestError(
            error instanceof Error ? error.message : "Serial input queue is full."
          );
        throw error;
      }
    } else {
      if (state.kind !== "debugger" || !connection.debug)
        throw new InstrumentRequestError(
          "Connect the debugger's virtual DEBUG port before controlling the CPU."
        );
      if (action === "step") {
        if (connection.target === "esp32s3" || !runtime.stepInstruction)
          throw new InstrumentRequestError(
            "Instruction stepping is unavailable in this adapter."
          );
        if (!["ready", "paused"].includes(this.status))
          throw new InstrumentRequestError(
            "Pause the CPU before instruction stepping."
          );
        state.error = void 0;
        return runtime.stepInstruction();
      }
      if (action === "pause" && this.status !== "running")
        throw new InstrumentRequestError("Pause requires a running MCU.");
      if (action === "resume" && this.status !== "paused")
        throw new InstrumentRequestError("Continue requires a paused MCU.");
      runtime[action]();
      if (action === "reset")
        for (const entry of Object.values(this.entries)) {
          entry.log = "";
          entry.error = void 0;
        }
    }
    state.error = void 0;
  }
  /** @brief Preserve an action error on its own instrument without changing firmware execution state. */
  recordError(componentId, error) {
    const message = error instanceof Error ? error.message : "Instrument operation failed.";
    if (this.entries[componentId]) this.entries[componentId].error = message;
    return message;
  }
  /** @brief Reset presentation history along with a reset CPU; no global console history is copied. */
  clear() {
    for (const entry of Object.values(this.entries)) {
      entry.log = "";
      entry.error = void 0;
    }
  }
};
export {
  AvrRuntime,
  CircuitRuntime,
  ENGINE_CONTRACT_VERSION,
  Esp32S3Runtime,
  InstrumentRequestError,
  InstrumentSession,
  UnoRuntime,
  buttonInputs,
  capabilities,
  catalog,
  componentCategory,
  componentPins,
  controllerPinStates,
  controllerStarter,
  createComponentsExample,
  createSampleProject,
  createYdExample,
  newWorkspace,
  parseProject,
  parseWorkspace,
  projectSignals,
  simulationTarget
};
