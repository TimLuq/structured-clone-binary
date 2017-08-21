"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const serializer_1 = require("./serializer");
const unserializer_1 = require("./unserializer");
const test1_1 = require("./tests/test1");
const test0arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1024];
const test0Obj = { x: 5, arr: test0arr };
const test0 = ["hej", "hå", 0, true, null, 0x00FFFFFF, 500.67, test0arr, test0arr, [true, true, false, false, true], test0Obj];
const tests = [test0, test1_1.default];
for (let testid = 0; testid < tests.length; testid++) {
    const test = tests[testid];
    console.log("Running test %i on: \n", testid, test);
    JSON.stringify(test);
    serializer_1.default(test);
    console.time("encode JSON");
    let jsonstr = null;
    for (let i = 0; i < 100; i++) {
        jsonstr = JSON.stringify(test);
    }
    console.timeEnd("encode JSON");
    console.log("JSON length: %i", jsonstr.length);
    console.time("encode SCA");
    let encoded = null;
    for (let i = 0; i < 100; i++) {
        encoded = serializer_1.default(test);
    }
    console.timeEnd("encode SCA");
    const hex = new Uint8Array(encoded).reduce((p, x) => {
        let y = x.toString(16);
        if (x < 16) {
            y = "0" + y;
        }
        p.push(y);
        return p;
    }, []).join("");
    console.log("Encoded:\n", encoded, hex);
    JSON.parse(jsonstr);
    unserializer_1.default(encoded);
    console.time("decode JSON");
    let result0json = null;
    for (let i = 0; i < 100; i++) {
        result0json = JSON.parse(jsonstr);
    }
    console.timeEnd("decode JSON");
    console.log("JSON Result type: %s", typeof result0json);
    console.time("decode SCA");
    let result0 = null;
    for (let i = 0; i < 100; i++) {
        result0 = unserializer_1.default(encoded);
    }
    console.timeEnd("decode SCA");
    console.log("Decode Result (%i): \n", result0.byteLength, result0.value);
}
//# sourceMappingURL=test.js.map