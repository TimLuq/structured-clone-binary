Pure JS implementation of a Structured Clone Algorithm to/from an ArrayBuffer.

Right now its performance is significantly lower than that of native JSON serialization.

My basic test cases show, in Node.js v8.4, somewhere around 30-40 times the execution time for repeated serialization as compared to `JSON.stringify`.
Deserialization is almost as bad at around 10-20 times the execution time of `JSON.parse` in my test case.

If large objects are referred to multiple times I expect this balance to shift, though I'm not sure if that is common in real-world cases.

Byte length of the serialized data, read "through the wire", is about 33% of unpretty-JSON in my test case.