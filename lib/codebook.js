const { BitReadStream } = require('./bit-readstream');

class InvalidIdError extends Error {
    constructor(message) {
        super(message);

        this.name = this.constructor.name;

        Error.captureStackTrace(this, this.constructor);
    }
}

class Codebook {
    constructor(buf) {
        this._offsets_offset = buf.readUInt32LE(buf.length - 4);
        this._count = (buf.length - this._offsets_offset) / 4;
        this._data = buf.slice(0, this._offsets_offset);
        this._offsets = [];
    
        for (let i = 0; i < this._count; i++) {
            this._offsets[i] = buf.readUInt32LE(this._offsets_offset + i * 4);
        }
    }

    get_codebook(i) {
        // console.log("codebook:", i);
        if (i < 0 || i > this._offsets.length) {
            throw new InvalidIdError();
        }
        
        let start = this._offsets[i];
        let end = (i == this._offsets.length - 1) ? this._offsets_offset : this._offsets[i+1];

        return this._data.slice(start, end);
    }

    rebuild(id, outstream) {
        let codebook = this.get_codebook(id);
        this._rebuild(codebook, outstream);
    }

    _rebuild(buf, os) {
        //let ret = new Buffer(1024);
        /*let ret = new StreamBuffer();
        let os = new Bitstream();
        os.pipe(ret);*/

        let is = new BitReadStream(buf);

        let dimensions = is.readBits(4); //read 4 bits
        let entries = is.readBits(14); //read 14 bits

        //console.log("Codebook with", dimensions, "dimensions,", entries, "entries");

        /*ret.writeUIntBE(0x564342, 0, 3); //24bits
        ret.writeUInt16BE(dimensions, 3);
        ret.writeUIntBE(entries, 5, 3); //24bits*/
        os.writeBits(Buffer.from([ 0x42, 0x43, 0x56 ]), 24);
        os.writeUnsignedLE(dimensions, 16);
        os.writeUnsignedLE(entries, 24);

        let ordered = is.readBits(1);
        os.writeUnsignedLE(ordered, 1);

        if (ordered) {
            //console.log("Ordered");

            let initial_length = is.readBits(5);
            os.writeUnsignedLE(initial_length, 5);

            //console.log('intial length:', initial_length);

            let current_entry = 0;

            while (current_entry < entries) {
                let len = ilog(entries - current_entry);
                let number = is.readBits(len);
                os.writeUnsignedLE(number, len);

                //console.log('len', len);

                current_entry += number;
            }
        } else {
            let codeword_length_length = is.readBits(3);
            let sparse = is.readBits(1);

            //console.log("Unordered", codeword_length_length, "bit lengths");

            if (codeword_length_length == 0 || codeword_length_length > 5) {
                throw new Error('Nonsense codeword length');
            }

            os.writeUnsignedLE(sparse, 1);

            for (let i = 0; i < entries; i++) {
                let present_bool = true;

                if(sparse) {
                    let present = is.readBits(1);
                    os.writeUnsignedLE(present, 1);
                    present_bool = (0 != present);
                }

                // console.log("present_bool", present_bool);
                if (present_bool) {
                    let codeword_length = is.readBits(codeword_length_length);

                    os.writeUnsignedLE(codeword_length, 5);
                }
            }

            // console.log("true:", test_true, "| false:", test_false);
        }

        let lookup_type = is.readBits(1);
        os.writeUnsignedLE(lookup_type, 4);

        // if(lookup_type == 0) {
        //     console.log("no lookup table");
        // }
        if (lookup_type == 1) {
            //console.log("lookup type 1");
            os.writeUnsignedLE(is.readBits(32), 32); //min
            os.writeUnsignedLE(is.readBits(32), 32); //max
            let value_length = is.readBits(4);
            os.writeUnsignedLE(value_length, 4);
            os.writeUnsignedLE(is.readBits(1), 1); //sequence_flag(1)

            let quantvals = _book_maptype1_quantvals(entries, dimensions);
            for(let i = 0; i < quantvals; i++) {
                os.writeUnsignedLE(is.readBits(value_length + 1), value_length + 1);
            }
        }

        //console.log("total bits read =", is.getTotalReadBits());
        if (Math.floor(is.getTotalReadBits()/8) + 1 != buf.length) {
            console.log('Size mismatch. cb size: ' + buf.length + ' read: ' + (is.getTotalReadBits()/8 + 1));
            throw new Error('Size mismatch');
        }

        /*os.align();
        os.end();

        return ret.getBuffer();*/
    }
}

module.exports = { Codebook };

function ilog(v) {
    let ret = 0;
    while (v != 0) {
        ret++;
        v = v >> 1;
    }

    return ret;
}

function _book_maptype1_quantvals(entries, dimensions) {
    let bits = ilog(entries);
    let vals = entries >> ((bits-1)*(dimensions-1)/dimensions);

    while (true) {
        let acc = 1;
        let acc1 = 1;

        for(let i = 0; i < dimensions; i++) {
            acc *= vals;
            acc1 *= vals+1;
        }

        if (acc <= entries && acc1 > entries) {
            return vals;
        } else {
            if (acc > entries) {
                vals--;
            } else {
                vals++;
            }
        }
    }
}
