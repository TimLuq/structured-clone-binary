import { checkType, SCATYPE } from "./common";

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
 * Controls the memory of a stream and selects serialization methods based on type.
 */
class SCAUnserializerMemory {
    private readonly _container: Array<object | string> = [];

    public remember<T extends (object | string)>(obj: T): T {
        this._container.push(obj);
        return obj;
    }

    public recall(index: number): object | string | undefined {
        return this._container[index];
    }
}

export interface ISCAUnserializerOptions {
    allowFunctions?: boolean;
}

export interface ISCAUnserializerBuffer {
    uint8array?: Uint8Array;
    loopOffset?: number;
}

export interface IDecoded<T extends any> {
    byteLength: number;
    value: T;
}

export class SCAUnserializer {

    protected static decodeInt(buffer: DataView, offset: number, k?: IDecoded<number>): IDecoded<number> {
        if (!k) {
            k = { byteLength: 0, value: 0 };
        }

        const r = buffer.getUint8(offset);
        k.byteLength++;
        if ((r & 0x80) === 0) {
            k.value = (k.value << 6) | (r & 0x3F);
            if ((r & 0x40) !== 0) {
                k.value = -k.value;
            }
            return k;
        } else {
            k.value = (k.value << 7) | (r & 0x7F);
            return SCAUnserializer.decodeInt(buffer, offset + 1, k);
        }
    }

    protected static readUtf8(buffer: DataView, offset: number, length: number): string {
        const charCodes: number[] = [];

        function readTrail(len: number, val: number) {
            if (length < len) {
                throw new Error("Byte length ends in a multibyte character.");
            }
            length -= len;
            while (len--) {
                const c1 = buffer.getUint8(offset++);
                // console.log("Historical: 0x" + val.toString(16) + ", Current: 0x" + c1.toString(16));
                if ((c1 & 0xC0) !== 0x80) {
                    throw new Error("Invalid UTF-8 encoding: 0x" + c1.toString(16));
                }
                val = (val << 6) | (c1 & 0x3F);
            }
            return val;
        }

        while (length) {
            const c0 = buffer.getUint8(offset++);
            length--;
            if ((c0 & 0x80) === 0) {
                charCodes.push(c0);
            } else if ((c0 & 0xE0) === 0xC0) {
                charCodes.push(readTrail(1, c0 & 0x1F));
            } else if ((c0 & 0xF0) === 0xE0) {
                charCodes.push(readTrail(2, c0 & 0x0F));
            } else {
                throw new Error("Unsupported UTF-8 character: 0x" + c0.toString(16));
            }
        }

        return String.fromCharCode(...charCodes);
    }

    private readonly _memory = new SCAUnserializerMemory();
    private readonly _stream: DataView[] = [];
    private readonly _options: ISCAUnserializerOptions;

    public get options() {
        return this._options;
    }

    constructor(options?: ISCAUnserializerOptions) {
        this._options = options || {};
    }

    public decode(buffer: DataView, offset?: number): IDecoded<any> {
        if (!offset) {
            offset = 0;
        }

        const t = buffer.getUint8(offset);

        console.log("Detected type 0x" + t.toString(16));

        if (checkType(t, "CONST")) {
            if (t === SCATYPE.FALSE) {
                return { byteLength: 1, value: false };
            } else if (t === SCATYPE.TRUE) {
                return { byteLength: 1, value: true };
            } else if (t === SCATYPE.NULL) {
                return { byteLength: 1, value: null };
            } else if (t === SCATYPE.UNDEFINED) {
                return { byteLength: 1, value: undefined };
            } else if (t === SCATYPE.NAN) {
                return { byteLength: 1, value: NaN };
            } else {
                throw Error("Unknown CONST type");
            }
        }

        if (checkType(t, "REF")) {
            if (t === SCATYPE.REF_TRAILING_VALUE) {
                const r = SCAUnserializer.decodeInt(buffer, offset + 1);
                return { byteLength: r.byteLength + 1, value: this._memory.recall(r.value) };
            } else {
                return { byteLength: 1, value: this._memory.recall(t & 0xF) };
            }
        }

        if (checkType(t, "NUMBER")) {
            if (checkType(t, "INT")) {
                if (t === SCATYPE.INT_TRAILING_VALUE) {
                    const r = SCAUnserializer.decodeInt(buffer, offset + 1);
                    r.byteLength++;
                    return r;
                } else {
                    return { byteLength: 1, value: t & 0xF };
                }
            } else if (t === SCATYPE.DOUBLE_TRAILING_VALUE) {
                return { byteLength: 9, value: buffer.getFloat64(offset + 1) };
            } else {
                throw new Error("Unsupported NUMBER type");
            }
        }

        const useCache = checkType(t, "USE_CACHE");

        if (checkType(t, "REGEXP")) {
            const pattern: IDecoded<string> = this.decode(buffer, offset + 1);
            let byteLength = pattern.byteLength + 1;
            const flags: string[] = [];

            if (checkType(t, "REGEXP_TRAILING_FLAGS")) {
                const fr: IDecoded<string> = this.decode(buffer, offset + byteLength);
                byteLength += fr.byteLength;
                flags.push(fr.value);
            } else {
                if (checkType(t, "REGEXP_GLOBAL_FLAG")) {
                    flags.push("g");
                }
                if (checkType(t, "REGEXP_MULTILINE_FLAG")) {
                    flags.push("m");
                }
            }

            const rx = new RegExp(pattern.value, flags.length ? undefined : flags.join(""));
            if (useCache) {
                this._memory.remember(rx);
            }
            return { byteLength, value: rx };
        }

        if (checkType(t, "STRING")) {
            const { byteLength: blen, value: slen }: IDecoded<number> = checkType(t, "STRING_TRAILING_LENGTH") ?
                SCAUnserializer.decodeInt(buffer, offset + 1) : { byteLength: 0, value: (t & 0x0E) >> 1 };

            const rx = slen === 0 ? "" : SCAUnserializer.readUtf8(buffer, offset + 1 + blen, slen);
            if (useCache) {
                this._memory.remember(rx);
            }
            return { byteLength: blen + slen + 1, value: rx };
        }

        if (checkType(t, "ARRAY")) {
            if (checkType(t, "ARRAY_EMPTY")) {
                const rx: any[] = [];
                if (useCache) {
                    this._memory.remember(rx);
                }
                return { byteLength: 1, value: rx };
            }

            if (checkType(t, "ARRAY_MIXED")) {
                const { byteLength: blen, value: alen } = SCAUnserializer.decodeInt(buffer, offset + 1);
                console.log("Creating a mixed array of length", alen);
                const rx: any[] = new Array(alen);
                let totlen = blen + 1;
                if (useCache) {
                    this._memory.remember(rx);
                }

                for (let i = 0; i < alen; i++) {
                    const { byteLength: ilen, value: ival } = this.decode(buffer, offset + totlen);
                    totlen += ilen;
                    rx[i] = ival;
                }

                return { byteLength: totlen, value: rx };
            }

            if (checkType(t, "ARRAY_INT")) {
                const { byteLength: blen, value: alen } = SCAUnserializer.decodeInt(buffer, offset + 1);
                const rx: any[] = new Array(alen);
                let totlen = blen + 1;
                if (useCache) {
                    this._memory.remember(rx);
                }

                for (let i = 0; i < alen; i++) {
                    const { byteLength: ilen, value: ival } = SCAUnserializer.decodeInt(buffer, offset + totlen);
                    totlen += ilen;
                    rx[i] = ival;
                }

                return { byteLength: totlen, value: rx };
            }

            if (checkType(t, "ARRAY_DOUBLE")) {
                const { byteLength: blen, value: alen } = SCAUnserializer.decodeInt(buffer, offset + 1);
                const rx: any[] = new Array(alen);
                const totlen = blen + 1 + alen * 8;
                if (useCache) {
                    this._memory.remember(rx);
                }

                offset += blen + 1;
                for (let i = 0; i < alen; i++) {
                    const ival = buffer.getFloat64(offset);
                    offset += 8;
                    rx[i] = ival;
                }

                return { byteLength: totlen, value: rx };
            }

            if (checkType(t, "ARRAY_BOOL")) {
                const { byteLength: blen, value: alen } = SCAUnserializer.decodeInt(buffer, offset + 1);
                const rx: any[] = new Array(alen);
                const totlen = blen + 1 + Math.ceil(alen / 8);
                if (useCache) {
                    this._memory.remember(rx);
                }

                offset += blen + 1;
                for (let i = 0; i < alen; i += 8) {
                    const ival = buffer.getUint8(offset++);
                    for (let j = 7; j >= 0; j--) {
                        const ij = i + (7 - j);
                        if (ij >= alen) {
                            break;
                        }
                        rx[ij] = (ival & (1 << j)) !== 0;
                    }
                }

                return { byteLength: totlen, value: rx };
            }

            throw new Error("Decoding could not match any ARRAY type for 0x" + t.toString(16));
        }

        if (checkType(t, "OBJECT")) {
            const next = this.decode(buffer, offset + 1) as IDecoded<string[]>;
            if (!Array.isArray(next.value)) {
                throw new Error("Decoding object requiers an array of keys.");
            }
            const origOffset = offset;
            const result: { [k: string]: any; } = {};
            const keys = next.value;
            offset += 1 + next.byteLength;

            for (const key of keys) {
                const decVal = this.decode(buffer, offset);
                offset += decVal.byteLength;
                result[key] = decVal.value;
            }

            return { byteLength: offset - origOffset, value: result };
        }

        throw new Error("Decoding could not match any type for 0x" + t.toString(16));
    }

    protected cloneData(data: any) {
        this._stream.push(this._memory.remember(data));
    }
}

export default function scaUnserialize(data: DataView | ArrayBuffer): IDecoded<any> {
    const view = data instanceof DataView ? data : new DataView(data);
    return new SCAUnserializer().decode(view);
}
