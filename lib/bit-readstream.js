class BitReadStream {
    constructor(buf) {
        this._buf = buf;
        this._byte_offset = 0;
        this._bit_offset = 0;
        this._total_read_bits = 0;
    }

    readBits(bits) {
        let ret = this._readBits(this._buf, bits, this._byte_offset, this._bit_offset);
        this.seekBits(bits);
        this._total_read_bits += bits;
        return ret;
    }

    seekBytes(bytes) {
        this._byte_offset += bytes;
        
        if(this._byte_offset < 0) {
            this._byte_offset = 0;
        }
        
        if(this._byte_offset > this._buf.length) {
            this._byte_offset = this._buf.lenght - 2;
        }
    }

    seekToByte(byte) {
        this._byte_offset = byte;
        this._bit_offset = 0;

        if(this._byte_offset < 0) {
            this._byte_offset = 0;
        }

        if(this._byte_offset > this._buf.length) {
            this._byte_offset = this._buf.length - 2;
        }
    }

    seekBits(bits) {
        let bit_seek = bits % 8;
        let byte_seek = Math.floor(bits / 8);

        this._bit_offset += bit_seek;
        byte_seek += Math.floor(this._bit_offset / 8);
        this._bit_offset = this._bit_offset % 8;

        this.seekBytes(byte_seek);
    }

    getTotalReadBits() {
        return this._total_read_bits;
    }

    _readBits(buf, bits, byte_offset, bit_offset) { // both offset are measured from the left
        let ret = 0;
        let left_mask = 0xFF;

        for(let i = 0; i < bit_offset; i++) {
            left_mask = left_mask >> 1;
        }
        
        let right_shift = (8 - ((bits + bit_offset) % 8)) % 8;
        let needed_bytes = Math.ceil((bit_offset + bits) / 8);

        if(byte_offset + needed_bytes > buf.length) {
            throw new Error('Trying to read out of bounds');
        }

        for(let cb = 0; cb < needed_bytes; cb++) {
            let byte = buf.readUInt8(byte_offset + cb);

            byte = this._mirrorBin(byte, 8);

            if(cb == 0) {
                byte = byte & left_mask;
            }

            ret += byte << (8 * (needed_bytes - 1 - cb));
        }

        ret = ret >> right_shift;
        ret = this._mirrorBin(ret, bits);

        return ret;
    }

    _mirrorBin(input, len) {
        let output = 0;
        
        for(let i = 0; i < len; i++) {
            output <<= 1;
            output += (input >> i) & 0x01;
        }
        
        return output;
    }
}

module.exports = { BitReadStream };
