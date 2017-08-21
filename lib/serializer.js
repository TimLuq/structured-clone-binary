"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const common_1 = require("./common");
if (typeof DataCloneError === "undefined") {
    /* tslint:disable:no-shadowed-variable */
    class DataCloneError extends Error {
        constructor(message) {
            super(message);
        }
    }
}
function writeInteger(buffer, value, offset) {
    if (value >= 0 && value <= 0x3F) {
        if (Array.isArray(buffer)) {
            buffer.push(value);
        }
        else {
            buffer.setUint8(offset, value);
        }
        return 1;
    }
    else if (value < 0 && value >= -0x3F) {
        if (Array.isArray(buffer)) {
            buffer.push(Math.abs(value) | 0x40);
        }
        else {
            buffer.setUint8(offset, Math.abs(value) | 0x40);
        }
        return 1;
    }
    else {
        const tmp = [];
        if (value < 0) {
            value = Math.abs(value);
            tmp.push((value & 0x3F) | 0x40);
        }
        else {
            tmp.push((value & 0x3F));
        }
        value >>= 6;
        while (value !== 0) {
            tmp.push((value & 0x7F) | 0x80);
            value >>= 7;
        }
        if (Array.isArray(buffer)) {
            while (tmp.length) {
                buffer.push(tmp.pop());
            }
            return tmp.length;
        }
        else {
            let i = offset;
            while (tmp.length) {
                buffer.setUint8(i++, tmp.pop());
            }
            return i - offset;
        }
    }
}
function filterMap(filter, map) {
    return new Map((function* (it) {
        while (true) {
            const res = it.next();
            if (res.done) {
                break;
            }
            if (filter(res.value)) {
                yield res.value;
            }
        }
    })(map.entries()));
}
/**
 * Controls the memory of a stream and selects serialization methods based on type.
 */
class SCASerializerMemory {
    constructor() {
        this._refCounter = 0;
        this._container = new Map();
    }
    remember(obj) {
        const t = typeof obj;
        if (this.memerable(obj, t)) {
            return this.rememberObject(obj, t);
        }
        else if (t === "number") {
            return SCASerializerObjectNumber.get(obj);
        }
        else if (t === "boolean" || t === "undefined" || obj === null) {
            return obj;
        }
        else {
            throw new TypeError("Unsupported type: " + t);
        }
    }
    memerable(obj, type) {
        if (!type) {
            type = typeof obj;
        }
        return type === "string" || (obj !== null && type === "object");
    }
    forceRemember(obj, val) {
        this._container.set(obj, val);
        return this;
    }
    cull() {
        this._container = filterMap((entry) => Boolean(entry[1].getRef()), this._container);
        return this;
    }
    clear() {
        this._container.clear();
        return this;
    }
    rememberObject(obj, type) {
        if (!type) {
            type = typeof obj;
        }
        const o = this._container.get(obj);
        if (o !== undefined) {
            let ref = o.getRef();
            if (!ref) {
                ref = new SCASerializerObjectRef(o, this._refCounter++);
            }
            return ref;
        }
        else if (type === "string") {
            return new SCASerializerObjectString(this, obj);
        }
        else if (Array.isArray(obj)) {
            return new SCASerializerObjectArray(this, obj);
        }
        else if (obj instanceof RegExp) {
            return new SCASerializerObjectRegExp(this, obj);
            // } else if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
            //     return new SCASerializerObjectBuffer(this, obj);
        }
        else if (Object.getPrototypeOf(obj) === Object.prototype) {
            // First level object
            return new SCASerializerObjectObject(this, obj);
        }
        else {
            throw new Error("Unsupported value: " + obj);
        }
    }
}
/**
 * Base class, should never be instanciated directly.
 */
class SCASerializerObjectBase {
    constructor(memory, obj) {
        this._ref = null;
        this.memory = memory;
        this.obj = obj;
        if (memory && obj) {
            switch (typeof obj) {
                case "string":
                case "object":
                    memory.forceRemember(obj, this);
                    break;
            }
        }
    }
    /**
     * Get the common reference if this object us used in multiple places.
     */
    getRef() {
        return this._ref;
    }
}
/**
 * References to a previously used object
 */
class SCASerializerObjectRef extends SCASerializerObjectBase {
    constructor(obj, index) {
        super(null, obj.obj);
        this._uses = 1;
        this.index = index;
        obj._ref = this;
    }
    get byteLength() {
        return this.index >= 0xF ? (this.index > 0x3F ? 3 : 2) : 1;
    }
    writeArrayBuffer(buffer, offset) {
        const l = this.byteLength;
        const isLong = l !== 1;
        if (isLong) {
            buffer.setUint8(offset, common_1.SCATYPE.REF_TRAILING_VALUE);
            return writeInteger(buffer, offset + 1, this.index) + 1;
        }
        else {
            buffer.setUint8(offset, common_1.SCATYPE.REF | this.index);
            return 1;
        }
    }
}
/**
 * Creates cloned strings and globally caches strings of length < 7
 */
class SCASerializerObjectString extends SCASerializerObjectBase {
    constructor(memory, str) {
        super(memory, str);
        // try to use cahced data
        const cached = SCASerializerObjectString._cached.get(str);
        if (cached) {
            this.data = cached;
            return;
        }
        const arr = [];
        const l = str.length;
        // make utf8
        for (let i = 0; i < l; i++) {
            const p = str.charCodeAt(i);
            if ((p & 0x7F) === p) {
                arr.push(p);
            }
            else if ((p & 0x7FF) === p) {
                arr.push(((p & 0x7C0) >> 6) | 0xC0, (p & 0x3F) | 0x80);
            }
            else if ((p & 0xFFFF) === p) {
                arr.push(((p & 0xF000) >> 12) | 0xC0, ((p & 0xFC0) >> 6) | 0x80, (p & 0x3F) | 0x80);
            }
            else {
                throw new Error("CharCode at more than 16 bits unsupported.");
            }
        }
        // add header
        const bytelen = arr.length;
        if (bytelen < 7) {
            arr.unshift(common_1.SCATYPE.STRING | (bytelen << 1));
        }
        else {
            const hdr = [common_1.SCATYPE.STRING_TRAILING_LENGTH];
            writeInteger(hdr, bytelen);
            arr.unshift.apply(arr, hdr);
        }
        // store
        this.data = new Uint8Array(arr);
        if (bytelen < 7) {
            SCASerializerObjectString._cached.set(str, this.data);
        }
    }
    get byteLength() {
        return this.data.byteLength;
    }
    writeArrayBuffer(buffer, offset) {
        if (!buffer.uint8array) {
            buffer.uint8array = new Uint8Array(buffer.buffer);
        }
        buffer.uint8array.set(this.data, offset);
        return this.data.byteLength;
    }
}
SCASerializerObjectString._cached = new Map();
/**
 * header and, if number is negative or >= 15, calls writeInteger.
 */
function computeSerializedInt(num) {
    const arr = [];
    if (num >= 0 && num < 15) {
        arr.push(common_1.SCATYPE.INT | num);
    }
    else {
        arr.push(common_1.SCATYPE.INT_TRAILING_VALUE);
        writeInteger(arr, num);
    }
    return new Uint8Array(arr);
}
/**
 * Header byte + 64-bit double in big endian.
 */
function computeSerializedDouble(num) {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, common_1.SCATYPE.DOUBLE_TRAILING_VALUE);
    view.setFloat64(1, num);
    return new Uint8Array(buffer);
}
/**
 * Class for serialization of numbers. Caches integers globally.
 */
class SCASerializerObjectNumber extends SCASerializerObjectBase {
    constructor(computation, num) {
        super(null, num);
        this.data = computation(num);
    }
    static get(num) {
        if (isNaN(num)) {
            return SCASerializerObjectNumber.NAN;
        }
        else if ((num | 0) === num) {
            const cached = SCASerializerObjectNumber._cached.get(num);
            if (cached) {
                return cached;
            }
            else {
                const r = new SCASerializerObjectNumber(computeSerializedInt, num);
                SCASerializerObjectNumber._cached.set(num, r);
                return r;
            }
        }
        else {
            return new SCASerializerObjectNumber(computeSerializedDouble, num);
        }
    }
    get byteLength() {
        return this.data.byteLength;
    }
    writeArrayBuffer(buffer, offset) {
        if (!buffer.uint8array) {
            buffer.uint8array = new Uint8Array(buffer.buffer);
        }
        buffer.uint8array.set(this.data, offset);
        return this.data.byteLength;
    }
}
SCASerializerObjectNumber.NAN = new SCASerializerObjectNumber(() => new Uint8Array([common_1.SCATYPE.NAN]), Number.NaN);
SCASerializerObjectNumber._cached = new Map();
/**
 * An array of other objects. Optimizations for arrays containing only integers, numbers, or booleans.
 */
class SCASerializerObjectArray extends SCASerializerObjectBase {
    constructor(memory, obj) {
        super(memory, obj);
        const len = obj.length;
        if (len === 0) {
            this.data = new Uint8Array([common_1.SCATYPE.ARRAY_EMPTY]);
        }
        else {
            let onlyInt = true;
            let onlyNumber = true;
            let onlyBool = true;
            for (const e of obj) {
                const t = typeof e;
                if (onlyNumber && t !== "number") {
                    onlyInt = false;
                    onlyNumber = false;
                    if (!onlyBool) {
                        break;
                    }
                }
                else if (onlyInt && e !== (e || 0)) {
                    onlyInt = false;
                }
                if (onlyBool && t !== "boolean") {
                    onlyBool = false;
                    if (!onlyNumber) {
                        break;
                    }
                }
            }
            if (onlyBool) {
                const parr = [common_1.SCATYPE.ARRAY_BOOL];
                writeInteger(parr, len);
                const arr = parr.concat(new Array(Math.ceil(len / 8)).map(() => 0));
                let i = 8;
                let offset = parr.length;
                for (const e of obj) {
                    i--;
                    if (e) {
                        arr[offset] |= 1 << i;
                    }
                    if (i === 0) {
                        i = 8;
                        offset++;
                    }
                }
                this.data = new Uint8Array(arr);
            }
            else if (onlyInt) {
                const arr = [common_1.SCATYPE.ARRAY_INT];
                writeInteger(arr, len);
                for (const e of obj) {
                    writeInteger(arr, e);
                }
                this.data = new Uint8Array(arr);
            }
            else if (onlyNumber) {
                const arr = [common_1.SCATYPE.ARRAY_DOUBLE];
                writeInteger(arr, len);
                const buf = new ArrayBuffer(arr.length + 8 * len);
                const v = new DataView(buf);
                let offset = arr.reduce((o, x) => {
                    v.setUint8(o, x);
                    return o++;
                }, 0);
                for (const e of obj) {
                    v.setFloat64(offset, e);
                    offset += 8;
                }
                this.data = new Uint8Array(buf);
            }
            else {
                const arr = [common_1.SCATYPE.ARRAY_MIXED];
                writeInteger(arr, len);
                this.data = Object.assign(obj.map((i) => memory.remember(i)), { byteLength: 0 });
                this.data.byteLength = this.data.reduce((p, x) => {
                    const l = x && x instanceof SCASerializerObjectBase ? x.byteLength : 1;
                    return p + l;
                }, arr.length);
            }
        }
    }
    get byteLength() {
        return this.data.byteLength;
    }
    writeArrayBuffer(buffer, offset) {
        if (this.data instanceof Uint8Array) {
            if (!buffer.uint8array) {
                buffer.uint8array = new Uint8Array(buffer.buffer);
            }
            buffer.uint8array.set(this.data, offset);
            return this.data.byteLength;
        }
        else {
            const arr = [common_1.SCATYPE.ARRAY_MIXED];
            const len = this.data.length;
            const origOffset = offset;
            writeInteger(arr, len);
            for (const byte of arr) {
                buffer.setUint8(offset++, byte);
            }
            for (const x of this.data) {
                const wlen = SCASerializer.writeToArrayBuffer(x, buffer, offset);
                if (wlen === 0) {
                    throw new Error("Failed to write to buffer, is the buffer large enough?");
                }
                offset += wlen;
            }
            return offset - origOffset;
        }
    }
}
/**
 * An first level object.
 */
class SCASerializerObjectObject extends SCASerializerObjectBase {
    constructor(memory, obj) {
        super(memory, obj);
        const objd = obj;
        const sortedkeys = Object.keys(obj).sort();
        const keyskey = sortedkeys.map((x) => JSON.stringify(x)).join("");
        let keys = SCASerializerObjectObject.keyLists.get(keyskey);
        if (!keys) {
            SCASerializerObjectObject.keyLists.set(keyskey, sortedkeys);
            keys = sortedkeys;
        }
        this.data = Object.assign([memory.remember(keys)].concat(keys.map((i) => memory.remember(objd[i]))), { byteLength: 0 });
        this.data.byteLength = this.data.reduce((p, x) => {
            const l = x && x instanceof SCASerializerObjectBase ? x.byteLength : 1;
            return p + l;
        }, 0);
    }
    get byteLength() {
        return this.data.byteLength + 1;
    }
    writeArrayBuffer(buffer, offset) {
        const origOffset = offset;
        buffer.setUint8(offset++, common_1.SCATYPE.OBJECT);
        for (const x of this.data) {
            const wlen = SCASerializer.writeToArrayBuffer(x, buffer, offset);
            if (wlen === 0) {
                throw new Error("Failed to write to buffer, is the buffer large enough?");
            }
            offset += wlen;
        }
        return offset - origOffset;
    }
}
SCASerializerObjectObject.keyLists = new Map();
class SCASerializerObjectRegExp extends SCASerializerObjectBase {
    constructor(memory, obj) {
        super(memory, obj);
        this.source = memory.remember(obj.source);
        const flags = obj.flags;
        switch (flags) {
            case "":
                this.byte = common_1.SCATYPE.REGEXP;
                this.flags = null;
                break;
            default:
                this.byte = common_1.SCATYPE.REGEXP_TRAILING_FLAGS;
                this.flags = memory.remember(obj.flags);
                break;
        }
    }
    get byteLength() {
        return this.source.byteLength + (this.flags ? this.flags.byteLength : 0) + 1;
    }
    writeArrayBuffer(buffer, offset) {
        const origOffset = offset;
        buffer.setUint8(offset++, this.byte);
        const slen = this.source.writeArrayBuffer(buffer, offset);
        offset += slen;
        if (this.flags) {
            this.flags.writeArrayBuffer(buffer, offset);
        }
        return offset - origOffset;
    }
}
class SCASerializer {
    constructor(options, ...data) {
        this._memory = new SCASerializerMemory();
        this._stream = [];
        this._cullable = false;
        this._listeners = {};
        this._options = options || {};
        for (const d of data) {
            this.write(d);
        }
    }
    static writeToArrayBuffer(x, buffer, offset) {
        const blen = buffer.byteLength;
        const origOffset = offset;
        if (x === null) {
            buffer.setUint8(offset, common_1.SCATYPE.NULL);
            offset++;
        }
        else if (x === undefined) {
            buffer.setUint8(offset, common_1.SCATYPE.UNDEFINED);
            offset++;
        }
        else if (x === true) {
            buffer.setUint8(offset, common_1.SCATYPE.TRUE);
            offset++;
        }
        else if (x === false) {
            buffer.setUint8(offset, common_1.SCATYPE.FALSE);
            offset++;
        }
        else if (x.byteLength + offset > blen) {
            return offset - origOffset;
        }
        else {
            const add = x.writeArrayBuffer(buffer, offset);
            if (x.getRef()) {
                const byte = buffer.getUint8(offset);
                if ((byte & 0x80) !== 0) {
                    buffer.setUint8(offset, byte | 0x01);
                }
            }
            offset += add;
        }
        return offset - origOffset;
    }
    get options() {
        return this._options;
    }
    toArrayBuffer() {
        const len = this._stream.reduce((p, x) => {
            if (x === null || x === undefined || x === true || x === false) {
                return p + 1;
            }
            else {
                return p + x.byteLength;
            }
        }, 0);
        const buff = new ArrayBuffer(len);
        const view = new DataView(buff);
        this.writeArrayBuffer(view);
        return buff;
    }
    writeArrayBuffer(buffer, offset) {
        if (!offset) {
            offset = 0;
        }
        const s = this._stream;
        if (s.length === 0) {
            return -1;
        }
        if (this._cullable) {
            this._memory.cull();
            this._cullable = false;
        }
        const origOffset = offset;
        const blen = buffer.byteLength;
        while (s.length) {
            if (blen <= offset) {
                return offset - origOffset;
            }
            const x = s[0];
            const addlen = SCASerializer.writeToArrayBuffer(x, buffer, offset);
            if (addlen === 0) {
                return offset - origOffset;
            }
            else {
                offset += addlen;
            }
            s.pop();
        }
        return (offset - origOffset) || -1;
    }
    flush() {
        if (this._cullable) {
            this._memory.cull();
            this._cullable = false;
        }
        if (this._listeners.flush) {
            for (const l of this._listeners.flush) {
                l(this);
            }
        }
        return this;
    }
    write(...data) {
        let w = false;
        for (const d of data) {
            const writable = this._memory.remember(d);
            if (typeof writable === "object" && !writable.getRef()) {
                w = true;
            }
            this._stream.push(writable);
        }
        if (w) {
            this._cullable = true;
        }
        if (data.length && this._listeners.write) {
            for (const l of this._listeners.write) {
                l(this);
            }
        }
        return this;
    }
    on(event, listener) {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(listener);
        return this;
    }
    off(event, listener) {
        if (this._listeners[event]) {
            const i = this._listeners[event].indexOf(listener);
            this._listeners[event].splice(i, 1);
        }
        return this;
    }
}
exports.SCASerializer = SCASerializer;
function scaSerialize(data) {
    return new SCASerializer(undefined, data).toArrayBuffer();
}
exports.default = scaSerialize;
//# sourceMappingURL=serializer.js.map