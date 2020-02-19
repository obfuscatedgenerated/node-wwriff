// based on https://github.com/kkaefer/node-bitstream/blob/master/bitstream.js
// originally, this class worked as a ReadStream, but apparently, it's impossible to use them synchronously in newer node versions, so I switched to just emitting data events

// const { Readable } = require('stream');
const { EventEmitter } = require('events');

class Bitstream extends EventEmitter {
    static get _nulls() {
        return Buffer.alloc(32, 0);
    }

    static get BUFFER_SIZE() {
        return 1024;
    }

    constructor() {
        super();

        this._buffer = Buffer.alloc(Bitstream.BUFFER_SIZE);
        this._pos = 0; // Number of current byte.
        this._intra = 0; // Number of bits written in current byte.
        this._total = 0; // Number of bits that has been added to this stream.
    }

    /**
     * Writes a byte to the bitstream
     *
     * @param {Number} bits Byte to write.
     */
    writeByte(bits) {
        if (this._intra === 0) {
            // Aligned at byte boundary.
            this._buffer[this._pos] = bits;
            this._pos++;
            if (this._pos == this._buffer.length) this.flush();
        } else {
            // Copy first portion to current byte.
            this._buffer[this._pos] |= bits << this._intra;
            this._pos++;
            if (this._pos == this._buffer.length) this.flush();

            // Copy second portion to next byte.
            this._buffer[this._pos] = (bits & 0xFF) >> (8 - this._intra);
        }

        this._total += 8;
    }

    /**
     * Writes an unsigned integer up to 8 bits to the bitstream
     *
     * @param {Number} number Number to write.
     * @param {Number} length Amount of bits of the number to write.
     */
    writeUnsigned(bits, length) {
        if (length > 8) throw new Error('You need to specify an endianness when writing more than 8 bits');

        // Make sure we're not accidentally setting bits that shouldn't be set.
        bits &= (1 << length) - 1;

        let current = 8 - this._intra;
        if (this._intra === 0) {
            // Aligned at byte boundary.
            this._buffer[this._pos] = bits;
        } else {
            // Number of bits we can fit into the current byte.
            // node's Buffer implementation clamps this to 0xFF.
            this._buffer[this._pos] |= bits << this._intra;
        }

        this._total += length;
        this._intra += length;
        if (this._intra >= 8) {
            this._intra -= 8;
            this._pos++;
            if (this._pos == this._buffer.length) this.flush();

            if (current < length) {
                // We also have to write bits to the second byte.
                this._buffer[this._pos] = bits >> current;
            }
        }
    }

    /**
     * Writes bits to the bitstream
     *
     * @param {Buffer} bits  Contains the bits to write, aligned at position 0.
     *                      Bits are | 76543210 | FEDCBA98 | etc.
     * @param {Number} length Amount of valid bits in the buffer.
     */
    writeBits(bits, length) {
        if (!this._buffer) throw new Error('Stream is closed');

        let remainder = length % 8;
        let max = (length - remainder) / 8;

        if (bits.length < max || (remainder > 0 && bits.length == max)) {
            throw new Error(length + ' bits expected, but ' + (bits.length * 8) + ' passed');
        }

        if (this._intra === 0) {
            // Do an aligned copy.
            if (this._pos + max < this._buffer.length) {
                // Copy the bits if they fit in the current buffer.
                if (max > 0) {
                    bits.copy(this._buffer, this._pos, 0, max);
                    this._pos += max;
                    if (this._pos == this._buffer.length) this.flush();
                }
            } else {
                // The new bits wouldn't fit into the current buffer anyway, so flush
                // and passthrough the new bits.
                this.flush();
                // this.push(bits.slice(0, max));
                this.emit('data', bits.slice(0, max));
            }
            this._total += max * 8;
        } else {
            // Do unaligned copy.
            for (let pos = 0; pos < max; pos++) {
                this.writeByte(bits[pos]);
            }
        }

        // Write last byte.
        if (remainder) {
            this.writeUnsigned(bits[max], remainder);
        }
    }

    /**
     * Writes an unsigned big endian integer with a specified length to the bitstream
     *
     * @param {Number} number Number to write.
     * @param {Number} length Amount of bits of the number to write.
     */
    writeUnsignedBE(number, length) {
        if (!this._buffer) throw new Error('Stream is closed');

        let remainder = length % 8;
        let max = length - remainder;

        if (remainder) {
            this.writeUnsigned(number >>> max, remainder);
        }

        for (let pos = max - 8; pos >= 0; pos -= 8) {
            this.writeByte(number >>> pos);
        }
    }

    /**
     * Writes an unsigned little endian integer with a specified length to the bitstream
     *
     * @param {Number} number Number to write.
     * @param {Number} length Amount of bits of the number to write.
     */
    writeUnsignedLE(number, length) {
        if (!this._buffer) throw new Error('Stream is closed');

        let remainder = length % 8;
        let max = length - remainder;

        for (let pos = 0; pos < max; pos += 8) {
            this.writeByte(number >>> pos);
        }

        if (remainder) {
            this.writeUnsigned(number >>> max, remainder);
        }
    }

    writeUnsignedReversed(number, length) {
        for (let shift = length - 1; shift >= 0; shift--) {
            this.writeUnsigned(number >> shift, 1);
        }
    }

    end() {
        this.align();
        this.flush();
        // this.push(null);

        this._buffer = null;
        // delete this._pos;
    }

    // Aligns to stream to the next byte boundary by writing zeros.
    align(boundary) {
        if (typeof boundary == 'undefined' || boundary < 0 || !boundary) {
            boundary = 1;
        }

        if (boundary > Bitstream._nulls.length) {
            throw new Error('Maximum boundary align size is ' + Bitstream._nulls.length);
        }

        let valid = this._total % (boundary * 8);
        if (valid > 0) {
            this.writeBits(Bitstream._nulls, boundary * 8 - valid);
        }
    }

    // _read(size) {
    //     console.log("_read");
    //     this.flush();
    // }

    // Flushes the current buffer.
    flush() {
        if (this._buffer == null) {
            throw new Error("Stream has already been ended");
        }
        
        // Emit all valid whole bytes that have been written so far.
        // let result = this.push(this._buffer.slice(0, this._pos));
        this.emit('data', this._buffer.slice(0, this._pos));

        // Clean out the buffer and copy the last partial byte that we didn't emit yet.
        let buffer = Buffer.alloc(Bitstream.BUFFER_SIZE);
        buffer[0] = this._buffer[this._pos];
        this._buffer = buffer;
        this._pos = 0;

        // return result;
    }
}

module.exports = { Bitstream };