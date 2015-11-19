function BitReadStream(_buf) {
    var buf = _buf;
    var byte_offset = 0, bit_offset = 0;

    var total_read_bits = 0;

    this.readBits = function(bits) {
        var ret = readBits(buf, bits, byte_offset, bit_offset);
        this.seekBits(bits);
        total_read_bits += bits;
        return ret;
    }

    this.seekBytes = function(bytes) {
        byte_offset += bytes;
        if(byte_offset < 0) byte_offset = 0;
        if(byte_offset > buf.length) byte_offset = buf.lenght - 2;
    }

    this.seekBits = function(bits) {
        var bit_seek = bits % 8;
        var byte_seek = Math.floor(bits / 8);

        bit_offset += bit_seek;
        byte_seek += Math.floor(bit_offset / 8);
        bit_offset = bit_offset % 8;
        this.seekBytes(byte_seek);
    }

    this.getTotalReadBits = function() {
        return total_read_bits;
    }

    function readBits(buf, bits, byte_offset, bit_offset) { //both offset are measured from the left
        var ret = 0;
        var left_mask = 0xFF;
        for(var i = 0; i < bit_offset; i++) left_mask = left_mask >> 1;
        var right_shift = (8 - ((bits + bit_offset) % 8)) % 8;

        var needed_bytes = Math.ceil((bit_offset + bits) / 8);

        if(byte_offset + needed_bytes > buf.length) throw new Error('Trying to read out of bounds');

        for(var cb = 0; cb < needed_bytes; cb++) {
            var byte = buf.readUInt8(byte_offset + cb);

            byte = mirrorBin(byte, 8);

            if(cb == 0) byte = byte & left_mask;

            ret += byte << (8 * (needed_bytes - 1 - cb));
        }

        ret = ret >> right_shift;
        ret = mirrorBin(ret, bits);

        return ret;
    }

    function mirrorBin(input, len) {
        var output = 0;
        for(var i = 0; i < len; i++) {
            output <<= 1;
            output += (input >> i) & 0x01;
        }
        return output;
    }
}

module.exports = BitReadStream;
