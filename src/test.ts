import encode from "./serializer";
import decode from "./unserializer";

import test1 from "./tests/test1";

const test0arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1024];
const test0Obj = { x: 5, arr: test0arr };
const test0 = ["hej", "hå", 0, true, null, 0x00FFFFFF, 500.67, test0arr, test0arr, [true, true, false, false, true], test0Obj];

const tests: any[] = [test0, test1];

for (let testid = 0; testid < tests.length; testid++) {
    const test = tests[testid];

    console.log("Running test %i on: \n", testid, test);

    JSON.stringify(test);
    encode(test);

    console.time("encode JSON");
    let jsonstr: string = null;
    for (let i = 0; i < 100; i++) {
        jsonstr = JSON.stringify(test);
    }
    console.timeEnd("encode JSON");

    console.log("JSON length: %i", jsonstr.length);

    console.time("encode SCA");
    let encoded: ArrayBuffer = null;
    for (let i = 0; i < 100; i++) {
        encoded = encode(test);
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
    decode(encoded);

    console.time("decode JSON");
    let result0json: any = null;
    for (let i = 0; i < 100; i++) {
        result0json = JSON.parse(jsonstr);
    }
    console.timeEnd("decode JSON");

    console.log("JSON Result type: %s", typeof result0json);

    console.time("decode SCA");
    let result0 = null;
    for (let i = 0; i < 100; i++) {
        result0 = decode(encoded);
    }
    console.timeEnd("decode SCA");

    console.log("Decode Result (%i): \n", result0.byteLength, result0.value);
}
