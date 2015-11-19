var util = require('util');
var Writable = require('stream').Writable;

util.inherits(StreamBuffer, Writable);

function StreamBuffer(opts) {
    Writable.call(this, opts);
    this.buffers = [];
}

StreamBuffer.prototype._write = function(chunk, encoding, done) {
    this.buffers.push(chunk);
    done();
}

StreamBuffer.prototype.getBuffer = function() {
    return Buffer.concat(this.buffers);
}

module.exports = StreamBuffer;
