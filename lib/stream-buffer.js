const { Writable } = require('stream');

class StreamBuffer extends Writable {
    constructor(opts) {
        super(opts);

        this.buffers = [];
    }

    appendBuffer(buf) {
        this.buffers.push(buf);
    }

    _write(chunk, encoding, done) {
        this.buffers.push(chunk);
        done();
    }

    getBuffer() {
        return Buffer.concat(this.buffers);
    }
}

module.exports = { StreamBuffer };