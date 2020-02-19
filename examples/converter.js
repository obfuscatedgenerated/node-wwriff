/*
* Converts a .wem file to .ogg
*
* Requires node-ogg
*/

const fs = require('fs');
const ogg = require('ogg');
const { Decoder } = require('../');

if(process.argv.length < 4) {
    console.log("Usage: node converter.js <input.wem> <codebooks.bin> [output.ogg]");
    console.log();
    console.log("NOTE: codebooks are not optional. If your file has inline codebooks it's not (yet) compatible with this converter.");
    process.exit();
}

const input_path = process.argv[2];
const codebooks_path = process.argv[3];
const output_path = (process.argv.length > 4) ? process.argv[4] : input_path + '.ogg';

const instream = fs.createReadStream(input_path);
const decoder = new Decoder();
decoder.setCodebook(codebooks_path);

const encoder = new ogg.Encoder();
const outstream = fs.createWriteStream(output_path);

instream.pipe(decoder).pipe(encoder.stream(1));
encoder.pipe(outstream);
