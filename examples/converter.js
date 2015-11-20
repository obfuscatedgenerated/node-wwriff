/*
* Converts a .wem file to .ogg
*
* Requires node-ogg
*/

var Wwriff_Decoder = require('../index.js').Decoder;
var fs = require('fs');
var ogg = require('ogg');

if(process.argv.length < 4) {
    console.log("Usage: node converter.js <input.wem> <codebooks.bin> [output.ogg]")
    console.log();
    console.log("NOTE: codebooks are not optional. If your file has inline codebooks it's not (yet) compatible with this converter.");
    process.exit();
}

var input_path = process.argv[2];
var codebooks_path = process.argv[3];
var output_path = (process.argv.length > 4) ? process.argv[4] : input_path + '.ogg';

var instream = fs.createReadStream(input_path);
var decoder = new Wwriff_Decoder();
decoder.setCodebook(codebooks_path);

var encoder = new ogg.Encoder();
var outstream = fs.createWriteStream(output_path);

instream.pipe(decoder).pipe(encoder.stream(1));
encoder.pipe(outstream);
