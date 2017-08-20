
export type SCATYPE_KEY = keyof typeof SCATYPE_BITS_INTERNAL;
export type SCATYPE_OBJECT = {[T in keyof typeof SCATYPE_BITS_INTERNAL]: number; };

const SCATYPE_BITS_INTERNAL = {
    /* tslint:disable:object-literal-sort-keys */
    CONST: 0xF0,
    NULL: 0xFF,
    UNDEFINED: 0xFF,
    TRUE: 0xFF,
    FALSE: 0xFF,
    NAN: 0xFF,

    REF: 0xF0,
    REF_TRAILING_VALUE: 0xFF,

    NUMBER: 0xE0,
    INT: 0xF0,
    INT_TRAILING_VALUE: 0xFF,
    DOUBLE_TRAILING_VALUE: 0xFF,

    CACHABLE: 0x80,
    USE_CACHE: 0x81,

    OBJECT: 0xF0,

    REGEXP: 0xF0,
    REGEXP_TRAILING_FLAGS: 0xFE,
    REGEXP_GLOBAL_FLAG: 0xFA,
    REGEXP_MULTILINE_FLAG: 0xFC,

    ARRAY: 0xF0,
    ARRAY_EMPTY: 0xFE,
    ARRAY_MIXED: 0xFE,
    ARRAY_INT: 0xFE,
    ARRAY_DOUBLE: 0xFE,
    ARRAY_BOOL: 0xFE,

    STRING: 0xF0,
    STRING_TRAILING_LENGTH: 0xFE,
};
export const SCATYPE_BITS: SCATYPE_OBJECT = SCATYPE_BITS_INTERNAL;

export function checkType(byte: number, type: SCATYPE_KEY): boolean {
    const ref = SCATYPE[type];
    return (byte & SCATYPE_BITS[type]) === ref;
}

export enum SCATYPE {
    CONST = 0x00,
    UNDEFINED = 0x00,
    TRUE = 0x01,
    FALSE = 0x03,
    NULL = 0x02,
    NAN = 0x04,

    REF = 0x10,
    REF_TRAILING_VALUE = 0x1F,

    NUMBER = 0x20,
    INT = 0x20,
    INT_TRAILING_VALUE = 0x2F,
    DOUBLE_TRAILING_VALUE = 0x3F,

    CACHABLE = 0x80,
    USE_CACHE = 0x81,

    OBJECT = 0x90,

    REGEXP = 0xA0,
    REGEXP_TRAILING_FLAGS = 0xAE,
    REGEXP_GLOBAL_FLAG = 0xA2,
    REGEXP_MULTILINE_FLAG = 0xA4,

    ARRAY = 0xB0,
    ARRAY_EMPTY = 0xB2,
    ARRAY_MIXED = 0xB4,
    ARRAY_INT = 0xB6,
    ARRAY_DOUBLE = 0xB8,
    ARRAY_BOOL = 0xBA,

    STRING = 0xC0,
    STRING_TRAILING_LENGTH = 0xCE,
}
