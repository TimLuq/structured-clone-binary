import encode from "./serializer";
import decode from "./unserializer";

const test0arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 1024];
const test0Obj = { x: 5, arr: test0arr };
const test0 = ["hej", "hå", 0, true, null, 0x00FFFFFF, 500.67, test0arr, test0arr, [true, true, false, false, true], test0Obj];
console.log("Running test on: \n", test0);
console.time("encode");
const encoded = encode(test0);
console.timeEnd("encode");
const hex = new Uint8Array(encoded).reduce((p, x) => {
    let y = x.toString(16);
    if (x < 16) {
        y = "0" + y;
    }
    p.push(y);
    return p;
}, []).join("");
console.log("Encoded:\n", encoded, hex);
console.time("decode");
const result0 = decode(encoded);
console.timeEnd("decode");
console.log("Test Result (%i): \n", result0.byteLength, result0.value);
