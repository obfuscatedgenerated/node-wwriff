var Wwriff_Decoder = require('./index.js');
var fs = require('fs');
var ogg = require('ogg');
var BitReadStream = require('./lib/bit-readstream.js');

//test();
//process.exit();

var instream = fs.createReadStream(process.argv[2]);
var decoder = new Wwriff_Decoder();
decoder.setCodebook('packed_codebooks_aoTuV_603.bin');

var encoder = new ogg.Encoder();

var outstream = fs.createWriteStream(process.argv[3]);

instream.pipe(decoder);
decoder.on('data', function(d) {
    console.log(d);
});
decoder.pipe(encoder.stream());
encoder.pipe(outstream);


function test() {
    var buf = new Buffer([0b10101010, 0b01010101, 0b11110000, 0b00001111]);
    console.log(buf);
    var t = new BitReadStream(buf);

    t.seekBytes(2);
    console.log(t.readBits(3)); //111 = 7
    console.log(t.readBits(6)); //100000 = 32
    console.log(t.readBits(7)); //0001111 = 15;
}
