import { SCATYPE } from "./common";

declare class DataCloneError extends Error {
    public constructor(message?: string);
}

if (typeof DataCloneError === "undefined") {
    /* tslint:disable:no-shadowed-variable */
    class DataCloneError extends Error {
        public constructor(message?: string) {
            super(message);
        }
    }
}

/**
 * Writes a big endian variable length integer with the first bit in every byte as a continuation bit. Additionally the last byte (where cont-bit=0) contains sign at 0x40.
 */
function writeInteger(buffer: DataView, value: number, offset: number): number;
function writeInteger(buffer: number[], value: number): number;
function writeInteger(buffer: DataView | number[], value: number, offset?: number): number {
    if (value >= 0 && value <= 0x3F) {
        if (Array.isArray(buffer)) {
            buffer.push(value);
        } else {
            buffer.setUint8(offset, value);
        }
        return 1;
    } else if (value < 0 && value >= -0x3F) {
        if (Array.isArray(buffer)) {
            buffer.push(Math.abs(value) | 0x40);
        } else {
            buffer.setUint8(offset, Math.abs(value) | 0x40);
        }
        return 1;
    } else {
        const tmp: number[] = [];
        if (value < 0) {
            value = Math.abs(value);
            tmp.push((value & 0x3F) | 0x40);
        } else {
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
        } else {
            let i = offset;
            while (tmp.length) {
                buffer.setUint8(i++, tmp.pop());
            }
            return i - offset;
        }
    }
}

function filterMap<K, V>(filter: (entry: [K, V]) => boolean, map: Map<K, V>): Map<K, V> {
    return new Map<K, V>((function* (it: IterableIterator<[K, V]>): IterableIterator<[K, V]> {
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

type TSerialized<T extends any> = SCASerializerObjectBase<T> | null | undefined | boolean;
type TSerializable<T extends any> = TSerialized<T> | string | {} | any[];

/**
 * Controls the memory of a stream and selects serialization methods based on type.
 */
class SCASerializerMemory {
    private _refCounter: number = 0;
    private _container = new Map<object | string, SCASerializerObjectBase<object | string>>();

    public remember<T extends null>(obj: T): null;
    public remember<T extends undefined>(obj: T): undefined;
    public remember<T extends boolean>(obj: T): boolean;
    public remember<T extends number>(obj: T): SCASerializerObjectNumber;
    public remember<T extends string>(obj: T): SCASerializerObjectString;
    public remember<T extends object>(obj: T): SCASerializerObjectBase<T>;
    public remember<T>(obj: T): TSerialized<T> {
        const t = typeof obj;
        if (this.memerable(obj, t)) {
            return this.rememberObject(obj, t);
        } else if (t === "number") {
            return SCASerializerObjectNumber.get(obj as any as number) as any;
        } else if (t === "boolean" || t === "undefined" || obj === null) {
            return obj as T & (boolean | undefined | null);
        } else {
            throw new TypeError("Unsupported type: " + t);
        }
    }

    public memerable<T>(obj: T | object, type?: "string" | "number" | "boolean" | "symbol" | "function" | "object" | "undefined"): obj is (T & object) {
        if (!type) {
            type = typeof obj;
        }
        return type === "string" || (obj !== null && type === "object");
    }

    public forceRemember<T extends object | string>(obj: T, val: SCASerializerObjectBase<T>): this {
        this._container.set(obj, val);
        return this;
    }

    public cull(): this {
        this._container = filterMap((entry) => Boolean(entry[1].getRef()), this._container);
        return this;
    }

    public clear(): this {
        this._container.clear();
        return this;
    }

    private rememberObject<T extends (object | string)>(obj: T, type?: "string" | "number" | "boolean" | "symbol" | "function" | "object" | "undefined"): SCASerializerObjectBase<T> {
        if (!type) {
            type = typeof obj;
        }
        const o = this._container.get(obj) as any as SCASerializerObjectBase<T> | undefined;
        if (o !== undefined) {
            let ref: SCASerializerObjectRef<T> = o.getRef();
            if (!ref) {
                ref = new SCASerializerObjectRef<T>(o, this._refCounter++);
            }
            return ref;
        } else if (type === "string") {
            return new SCASerializerObjectString(this, obj as string) as any as SCASerializerObjectBase<T>;
        } else if (Array.isArray(obj)) {
            return new SCASerializerObjectArray(this, obj);
        } else if (obj instanceof RegExp) {
            return new SCASerializerObjectRegExp(this, obj) as any as SCASerializerObjectBase<T>;
            // } else if (obj instanceof ArrayBuffer || ArrayBuffer.isView(obj)) {
            //     return new SCASerializerObjectBuffer(this, obj);
        } else if (Object.getPrototypeOf(obj) === Object.prototype) {
            // First level object
            return new SCASerializerObjectObject(this, obj);
        } else {
            throw new Error("Unsupported value: " + obj);
        }
    }
}

/**
 * Base class, should never be instanciated directly.
 */
abstract class SCASerializerObjectBase<T> {
    protected readonly memory: SCASerializerMemory;
    protected _ref: SCASerializerObjectRef<T> = null;
    protected readonly obj: T;

    public constructor(memory: SCASerializerMemory, obj: T) {
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
    public getRef(): SCASerializerObjectRef<T> {
        return this._ref;
    }

    /**
     * The length in bytes this object is after serialization.
     */
    public abstract get byteLength(): number;

    /**
     * Write the serialized object to a buffer.
     */
    public abstract writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset: number): number;
}

/**
 * References to a previously used object
 */
class SCASerializerObjectRef<T> extends SCASerializerObjectBase<T> {
    public readonly index: number;
    private _uses: number = 1;

    constructor(obj: SCASerializerObjectBase<T>, index: number) {
        super(null, (obj as any).obj as T);
        this.index = index;
        (obj as any)._ref = this;
    }

    public get byteLength(): number {
        return this.index >= 0xF ? (this.index > 0x3F ? 3 : 2) : 1;
    }

    public writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset: number): number {
        const l = this.byteLength;
        const isLong = l !== 1;

        if (isLong) {
            buffer.setUint8(offset, SCATYPE.REF_TRAILING_VALUE);
            return writeInteger(buffer, offset + 1, this.index) + 1;
        } else {
            buffer.setUint8(offset, SCATYPE.REF | this.index);
            return 1;
        }
    }
}

/**
 * Creates cloned strings and globally caches strings of length < 7
 */
class SCASerializerObjectString extends SCASerializerObjectBase<string> {
    private static readonly _cached = new Map<string, Uint8Array>();

    public readonly index: number;
    private readonly data: Uint8Array;

    constructor(memory: SCASerializerMemory, str: string) {
        super(memory, str);

        // try to use cahced data
        const cached = SCASerializerObjectString._cached.get(str);
        if (cached) {
            this.data = cached;
            return;
        }

        const arr: number[] = [];
        const l = str.length;

        // make utf8
        for (let i = 0; i < l; i++) {
            const p = str.charCodeAt(i);
            if ((p & 0x7F) === p) {
                arr.push(p);
            } else if ((p & 0x7FF) === p) {
                arr.push(((p & 0x7C0) >> 6) | 0xC0, (p & 0x3F) | 0x80);
            } else if ((p & 0xFFFF) === p) {
                arr.push(((p & 0xF000) >> 12) | 0xC0, ((p & 0xFC0) >> 6) | 0x80, (p & 0x3F) | 0x80);
            } else {
                throw new Error("CharCode at more than 16 bits unsupported.");
            }
        }

        // add header
        const bytelen = arr.length;
        if (bytelen < 7) {
            arr.unshift(SCATYPE.STRING | (bytelen << 1));
        } else {
            const hdr = [SCATYPE.STRING_TRAILING_LENGTH];
            writeInteger(hdr, bytelen);
            arr.unshift.apply(arr, hdr);
        }

        // store
        this.data = new Uint8Array(arr);
        if (bytelen < 7) {
            SCASerializerObjectString._cached.set(str, this.data);
        }
    }

    public get byteLength(): number {
        return this.data.byteLength;
    }

    public writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset: number): number {
        if (!buffer.uint8array) {
            buffer.uint8array = new Uint8Array(buffer.buffer);
        }
        buffer.uint8array.set(this.data, offset);
        return this.data.byteLength;
    }
}

/**
 * header and, if number is negative or >= 15, calls writeInteger.
 */
function computeSerializedInt(num: number): Uint8Array {
    const arr: number[] = [];
    if (num >= 0 && num < 15) {
        arr.push(SCATYPE.INT | num);
    } else {
        arr.push(SCATYPE.INT_TRAILING_VALUE);
        writeInteger(arr, num);
    }
    return new Uint8Array(arr);
}

/**
 * Header byte + 64-bit double in big endian.
 */
function computeSerializedDouble(num: number): Uint8Array {
    const buffer = new ArrayBuffer(9);
    const view = new DataView(buffer);
    view.setUint8(0, SCATYPE.DOUBLE_TRAILING_VALUE);
    view.setFloat64(1, num);
    return new Uint8Array(buffer);
}

/**
 * Class for serialization of numbers. Caches integers globally.
 */
class SCASerializerObjectNumber extends SCASerializerObjectBase<number> {
    public static get(num: number): SCASerializerObjectNumber {
        if (isNaN(num)) {
            return SCASerializerObjectNumber.NAN;
        } else if ((num | 0) === num) {
            const cached = SCASerializerObjectNumber._cached.get(num);
            if (cached) {
                return cached;
            } else {
                const r = new SCASerializerObjectNumber(computeSerializedInt, num);
                SCASerializerObjectNumber._cached.set(num, r);
                return r;
            }
        } else {
            return new SCASerializerObjectNumber(computeSerializedDouble, num);
        }
    }

    private static readonly NAN = new SCASerializerObjectNumber(() => new Uint8Array([SCATYPE.NAN]), Number.NaN);
    private static readonly _cached = new Map<number, SCASerializerObjectNumber>();
    private readonly data: Uint8Array;

    private constructor(computation: (n: number) => Uint8Array, num: number) {
        super(null, num);
        this.data = computation(num);
    }

    public get byteLength(): number {
        return this.data.byteLength;
    }

    public writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset: number): number {
        if (!buffer.uint8array) {
            buffer.uint8array = new Uint8Array(buffer.buffer);
        }
        buffer.uint8array.set(this.data, offset);
        return this.data.byteLength;
    }
}

/**
 * An array of other objects. Optimizations for arrays containing only integers, numbers, or booleans.
 */
class SCASerializerObjectArray<T extends any[]> extends SCASerializerObjectBase<T> {
    private readonly data: Uint8Array | (Array<TSerialized<any>> & { byteLength: number; });

    public constructor(memory: SCASerializerMemory, obj: T) {
        super(memory, obj);
        const len = obj.length;

        if (len === 0) {
            this.data = new Uint8Array([SCATYPE.ARRAY_EMPTY]);
        } else {
            let onlyInt: boolean = true;
            let onlyNumber: boolean = true;
            let onlyBool: boolean = true;
            for (const e of obj) {
                const t = typeof e;
                if (onlyNumber && t !== "number") {
                    onlyInt = false;
                    onlyNumber = false;
                    if (!onlyBool) {
                        break;
                    }
                } else if (onlyInt && e !== (e || 0)) {
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
                const parr = [SCATYPE.ARRAY_BOOL];
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

            } else if (onlyInt) {
                const arr = [SCATYPE.ARRAY_INT];
                writeInteger(arr, len);
                for (const e of obj) {
                    writeInteger(arr, e as any as number);
                }
                this.data = new Uint8Array(arr);

            } else if (onlyNumber) {
                const arr = [SCATYPE.ARRAY_DOUBLE];
                writeInteger(arr, len);
                const buf = new ArrayBuffer(arr.length + 8 * len);
                const v = new DataView(buf);
                let offset = arr.reduce((o: number, x) => {
                    v.setUint8(o, x);
                    return o++;
                }, 0);
                for (const e of obj) {
                    v.setFloat64(offset, e as any as number);
                    offset += 8;
                }
                this.data = new Uint8Array(buf);

            } else {
                const arr = [SCATYPE.ARRAY_MIXED];
                writeInteger(arr, len);
                this.data = Object.assign(obj.map((i) => memory.remember(i) as TSerialized<any>), { byteLength: 0 });
                this.data.byteLength = this.data.reduce((p, x) => {
                    const l = x && x instanceof SCASerializerObjectBase ? x.byteLength : 1;
                    return p + l;
                }, arr.length);
            }
        }
    }

    public get byteLength(): number {
        return this.data.byteLength;
    }

    public writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset: number): number {
        if (this.data instanceof Uint8Array) {
            if (!buffer.uint8array) {
                buffer.uint8array = new Uint8Array(buffer.buffer);
            }
            buffer.uint8array.set(this.data, offset);
            return this.data.byteLength;
        } else {
            const arr = [SCATYPE.ARRAY_MIXED];
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
class SCASerializerObjectObject<T extends {}> extends SCASerializerObjectBase<T> {
    private static readonly keyLists = new Map<string, string[]>();
    private readonly data: (Array<TSerialized<any>> & { byteLength: number; });

    public constructor(memory: SCASerializerMemory, obj: T) {
        super(memory, obj);
        const objd = obj as { [k: string]: any };
        const sortedkeys = Object.keys(obj).sort();
        const keyskey = sortedkeys.map((x) => JSON.stringify(x)).join("");
        let keys = SCASerializerObjectObject.keyLists.get(keyskey);
        if (!keys) {
            SCASerializerObjectObject.keyLists.set(keyskey, sortedkeys);
            keys = sortedkeys;
        }

        this.data = Object.assign([memory.remember(keys) as TSerialized<any>].concat(keys.map((i) => memory.remember(objd[i]) as TSerialized<any>)), { byteLength: 0 });
        this.data.byteLength = this.data.reduce((p, x) => {
            const l = x && x instanceof SCASerializerObjectBase ? x.byteLength : 1;
            return p + l;
        }, 0);
    }

    public get byteLength(): number {
        return this.data.byteLength + 1;
    }

    public writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset: number): number {
        const origOffset = offset;
        buffer.setUint8(offset++, SCATYPE.OBJECT);

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

class SCASerializerObjectRegExp extends SCASerializerObjectBase<RegExp> {
    private readonly byte: number;
    private readonly source: SCASerializerObjectString;
    private readonly flags: SCASerializerObjectString | null;

    constructor(memory: SCASerializerMemory, obj: RegExp) {
        super(memory, obj);
        this.source = memory.remember(obj.source);
        const flags = obj.flags;
        switch (flags) {
            case "":
                this.byte = SCATYPE.REGEXP;
                this.flags = null;
                break;
            default:
                this.byte = SCATYPE.REGEXP_TRAILING_FLAGS;
                this.flags = memory.remember(obj.flags);
                break;
        }
    }

    public get byteLength(): number {
        return this.source.byteLength + (this.flags ? this.flags.byteLength : 0) + 1;
    }

    public writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset: number): number {
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

export interface ISCASerializerOptions {
    allowFunctions?: boolean;
}

export interface ISCASerializerBuffer {
    uint8array?: Uint8Array;
}

interface ISCAListeners {
    flush?: Array<(serializer: SCASerializer) => any>;
    write?: Array<(serializer: SCASerializer) => any>;
}

export class SCASerializer {

    public static writeToArrayBuffer(x: TSerialized<any>, buffer: DataView & ISCASerializerBuffer, offset: number): number {
        const blen = buffer.byteLength;
        const origOffset = offset;
        if (x === null) {
            buffer.setUint8(offset, SCATYPE.NULL);
            offset++;
        } else if (x === undefined) {
            buffer.setUint8(offset, SCATYPE.UNDEFINED);
            offset++;
        } else if (x === true) {
            buffer.setUint8(offset, SCATYPE.TRUE);
            offset++;
        } else if (x === false) {
            buffer.setUint8(offset, SCATYPE.FALSE);
            offset++;
        } else if (x.byteLength + offset > blen) {
            return offset - origOffset;
        } else {
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

    private readonly _memory = new SCASerializerMemory();
    private readonly _stream: Array<SCASerializerObjectNumber | SCASerializerObjectBase<object> | null | undefined | boolean> = [];
    private readonly _options: ISCASerializerOptions;
    private _cullable: boolean = false;

    private readonly _listeners: ISCAListeners = {};

    public get options() {
        return this._options;
    }

    constructor(options?: ISCASerializerOptions, ...data: any[]) {
        this._options = options || {};
        for (const d of data) {
            this.write(d);
        }
    }

    public toArrayBuffer(): ArrayBuffer {
        const len = this._stream.reduce((p, x) => {
            if (x === null || x === undefined || x === true || x === false) {
                return p + 1;
            } else {
                return p + x.byteLength;
            }
        }, 0);
        const buff = new ArrayBuffer(len);
        const view = new DataView(buff);
        this.writeArrayBuffer(view);
        return buff;
    }

    public writeArrayBuffer(buffer: DataView & ISCASerializerBuffer, offset?: number): number {
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
            } else {
                offset += addlen;
            }
            s.pop();
        }
        return (offset - origOffset) || -1;
    }

    public flush(): this {
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

    public write(...data: any[]): this {
        let w = false;
        for (const d of data) {
            const writable: any = this._memory.remember(d);
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

    public on(event: keyof ISCAListeners, listener: (serializer: SCASerializer) => any): this {
        if (!this._listeners[event]) {
            this._listeners[event] = [];
        }
        this._listeners[event].push(listener);
        return this;
    }

    public off(event: keyof ISCAListeners, listener: (serializer: SCASerializer) => any): this {
        if (this._listeners[event]) {
            const i = this._listeners[event].indexOf(listener);
            this._listeners[event].splice(i, 1);
        }
        return this;
    }
}

export default function scaSerialize(data: any): ArrayBuffer {
    return new SCASerializer(undefined, data).toArrayBuffer();
}
