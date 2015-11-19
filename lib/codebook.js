var Bitstream = require('bitstream');
var StreamBuffer = require('./stream-buffer.js');
var BitReadStream = require('./bit-readstream.js');

function InvalidIdError(msg) {
    this.name = "InvalidIdError";
    this.message = "Invalid codebook id";
    this.stack = (new Error()).stack;
}
InvalidIdError.prototype = Object.create(Error.prototype);
InvalidIdError.prototype.constructor = InvalidIdError;

function Codebook(buf) {
    this._offsets_offset = buf.readUInt32LE(buf.length - 4);
    this._count = (buf.length - this._offsets_offset) / 4;
    this._data = buf.slice(0, this._offsets_offset);
    this._offsets = [];

    for(var i = 0; i < this._count; i++) {
        this._offsets[i] = buf.readUInt32LE(this._offsets_offset + i * 4);
    }
}

Codebook.prototype.get_codebook = function(i) {
    if(i < 0 || i > this._offsets.length) throw new InvalidIdError();
    var start = this._offsets[i];
    var end = (i == this._offsets.length - 1) ? this._offsets_offset : this._offsets[i+1];

    return this._data.slice(start, end);
}

Codebook.prototype.rebuild = function(id) {
    var codebook = this.get_codebook(id);
    this._rebuild(codebook)
}

Codebook.prototype._rebuild = function(buf) {
    //var ret = new Buffer(1024);
    var ret = new StreamBuffer();
    var os = new Bitstream();
    os.pipe(ret);

    var is = new BitReadStream(buf);

    var dimensions = is.readBits(4); //read 4 bits
    var entries = is.readBits(14); //read 14 bits

    //console.log("Codebook with", dimensions, "dimensions,", entries, "entries");

    /*ret.writeUIntBE(0x564342, 0, 3); //24bits
    ret.writeUInt16BE(dimensions, 3);
    ret.writeUIntBE(entries, 5, 3); //24bits*/
    os.writeBits(new Buffer([ 0x56, 0x43, 0x42 ]), 24);
    os.writeUnsignedLE(dimensions, 16);
    os.writeUnsignedLE(entries, 24);

    var ordered = is.readBits(1);
    os.writeUnsignedLE(ordered, 1);

    if(ordered) {
        //console.log("Ordered");

        var initial_length = is.readBits(5);
        os.writeUnsignedLE(initial_length, 5);

        var current_entry = 0;

        while(current_entry < entries) {
            var len = ilog(entries - current_entry);
            os.writeUnsignedLE(is.readBits(len), len);

            current_entry += len;
        }
    } else {
        var codeword_length_length = is.readBits(3);
        var sparse = is.readBits(1);

        //console.log("Unordered", codeword_length_length, "bit lengths");

        if(codeword_length_length == 0 || codeword_length_length > 5) {
            throw new Error('Nonsense codeword length');
        }

        os.writeUnsignedLE(sparse, 1);

        var test_true = 0, test_false = 0;

        for(var i = 0; i < entries; i++) {
            var present_bool = true;

            if(sparse) {
                var present = is.readBits(1);
                os.writeUnsignedLE(present, 1);
                present_bool = (0 != present);
            }

            //console.log("present_bool", present_bool);
            if(present_bool) {
                test_true++;

                var codeword_length = is.readBits(codeword_length_length);

                os.writeUnsignedLE(codeword_length, 5);
            } else {
                test_false++;
            }
        }

        //console.log("true:", test_true, "| false:", test_false);
    }

    var lookup_type = is.readBits(1);
    os.writeUnsignedLE(lookup_type, 4);

    if(lookup_type == 0) {
        //console.log("no lookup table");
    }
    if(lookup_type == 1) {
        //console.log("lookup type 1");
        os.writeUnsignedLE(is.readBits(32), 32); //min
        os.writeUnsignedLE(is.readBits(32), 32); //max
        var value_length = is.readBits(4);
        os.writeUnsignedLE(value_length, 4);
        os.writeUnsignedLE(is.readBits(1), 1); //sequence_flag(1)

        var quantvals = _book_maptype1_quantvals(entries, dimensions);
        for(var i = 0; i < quantvals; i++) {
            os.writeUnsignedLE(is.readBits(value_length + 1), value_length + 1);
        }
    }

    //console.log("total bits read =", is.getTotalReadBits());
    if(Math.floor(is.getTotalReadBits()/8) + 1 != buf.length) {
        //console.log('Size mismatch. cb size: ' + buf.length + ' read: ' + (is.getTotalReadBits()/8 + 1));
        throw new Error('Size mismatch');
    }

    os.align();
    os.end();

    return ret.getBuffer();
}

module.exports = Codebook;

function ilog(v) {
    var ret = 0;
    while(v != 0) {
        ret++;
        v = v >> 1;
    }
    return ret;
}

function _book_maptype1_quantvals(entries, dimensions) {
    var bits = ilog(entries);
    var vals = entries >> ((bits-1)*(dimensions-1)/dimensions);

    while(1) {
        acc = 1;
        acc1 = 1;
        for(var i = 0; i < dimensions; i++) {
            acc *= vals;
            acc1 *= vals+1;
        }
        if(acc <= entries && acc1 > entries) {
            return vals;
        } else {
            if(acc > entries) {
                vals--;
            } else {
                vals++;
            }
        }
    }
}
