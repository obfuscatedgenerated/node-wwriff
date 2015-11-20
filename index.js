var util = require('util');
var Transform = require('stream').Transform;
var ogg_packet = require('ogg-packet');
var Codebook = require('./lib/codebook.js')
var fs = require('fs');
var Bitstream = require('bitstream');
var StreamBuffer = require('./lib/stream-buffer.js');
var BitReadStream = require('./lib/bit-readstream.js');

util.inherits(Wwriff_Decoder, Transform);

function Wwriff_Decoder() {
    Transform.call(this, {readableObjectMode: true});

    this._codebook = null;

    this._chunknumber = 0;
    this._chunk_offset = 0;

    this._packetno = 3; //first 3 packets are pre-defined

    this._fmt = null;
    this._vorb = null;
    this._info = {};
    this._found_chunks = [];
    this._current_chunk_type = null;
    this._current_chunk_rest = null;
    this._vorbis_header_written = false;
    this._total_offset = 0;

    this._last_blocksize = 0;
    this._granpos = 0;

    this._little_endian = true;
    this._read_16 = function(buf, offset) {return buf.readUInt16LE(offset);}
    this._read_32 = function(buf, offset) {return buf.readUInt32LE(offset);}
}

Wwriff_Decoder.prototype.setCodebook = function(path) {
    if(!fs.existsSync(path)) {
        console.log('The given codebook file does not exist.');
        return;
    }

    console.log('Setting codebook to', path);
    try {
        var codebook = fs.readFileSync(path);
        this._codebook = new Codebook(codebook);
    } catch(e) {
        console.log('Error while reading codebook', e);
    }
}

Wwriff_Decoder.prototype._transform = function(_chunk, encoding, done) {
    console.log(this._current_chunk_type, _chunk.length);

    if(this._current_chunk_rest != null) {
        var chunk = Buffer.concat([this._current_chunk_rest, _chunk]);
    } else {
        var chunk = _chunk;
    }

    var pos = 0;

    if(this._chunknumber == 0) {
        this._read_riff_header(chunk.slice(0, 12));
        pos = 12;
    }

    if(this._current_chunk_type == "data") {
        this._read_data_chunk(chunk);
    } else {
        while(true) {
            if(pos + 8 > chunk.length) {
                this._current_chunk_rest = chunk.slice(pos);
                break;
            }
            var type = chunk.toString('utf8', pos, pos + 4);
            var size = this._read_32(chunk, pos + 4);
            pos += 8;
            if(pos + size > chunk.length && type != "data") {
                this._current_chunk_rest = chunk.slice(pos - 8);
                break;
            }
            if(size == 0) {
                break;
            }


            switch(type) {
                case "fmt ":
                    this._read_fmt_chunk(chunk.slice(pos, pos + size));
                    pos += size;
                    break;
                case "data":
                    console.log("pos:", pos);
                    this._total_offset = pos;
                    this._info.file_size = pos + size;
                    this._current_chunk_type = "data";
                    this._read_data_chunk(chunk.slice(pos));
                    this._chunknumber++;
                    return done();
                    break;
                default:
                    console.log('Ignoring', type, 'chunk');
                    pos += size;
                    break;
            }
        }
    }

    this._chunknumber++;

    done();
}

Wwriff_Decoder.prototype._read_data_chunk = function(chunk) {
    if(!this._vorbis_header_written) {
        //console.log('Writing vorbis header packets');
        var setup_packet = this._generateOggPacket3(chunk);
        if(setup_packet != null) {
            this.push(this._generateOggPacket1());
            this.push(this._generateOggPacket2());
            this.push(setup_packet);
            this._vorbis_header_written = true;
        } else {
            this._current_chunk_rest = chunk;
            return;
        }
    }

    var offset = 0;
    var ogg_flush = false;
    if(this._packetno == 3) { //first audio packet after header
        offset = this._vorb.first_audio_packet_offset;
    }
    var ogg_end = 0;

    var prev_blockflag = 0;
    var next_blockflag = 0;
    var is = new BitReadStream(chunk);

    while(true) {
        //console.log("offset:", offset , "offset 2:", this._total_offset + offset);
        var packet = new Packet(chunk, offset, this._little_endian, true);
        if(packet.next_offset() + 2 > chunk.length) {
            this._total_offset += offset;
            this._current_chunk_rest = chunk.slice(offset);
            break;
        }
        var next_packet = new Packet(chunk, packet.next_offset(), this._little_endian, true);
        if(next_packet.next_offset() + 2 > chunk.length) {
            ogg_flush = true;
        }

        //console.log(packet.next_offset() + 2, chunk.length);

        var buffer = new StreamBuffer();
        var os = new Bitstream();
        os.pipe(buffer);

        is.seekToByte(packet.offset());

        os.writeUnsignedLE(0, 1); //packet type
        var mode_number = is.readBits(this._info.mode_bits);
        os.writeUnsignedLE(mode_number, this._info.mode_bits);

        var remainder = is.readBits(8 - this._info.mode_bits);
        if(this._info.mode_blockflag[mode_number]) {
            next_blockflag = false;
            if(this._total_offset + next_packet.next_offset() + next_packet.header_size() <= this._info.file_size) {
                if(next_packet.size() > 0) {
                    is.seekToByte(next_packet.offset());
                    var next_mode_number = is.readBits(this._info.mode_bits);
                    next_blockflag = this._info.mode_blockflag[next_mode_number];
                }
            }

            os.writeUnsignedLE(prev_blockflag, 1);
            os.writeUnsignedLE(next_blockflag, 1);
        }

        //console.log(this._packetno, " ", mode_number, remainder, next_mode_number, next_blockflag/1, prev_blockflag/1);

        prev_blockflag = this._info.mode_blockflag[mode_number];
        os.writeUnsignedLE(remainder, 8 - this._info.mode_bits);

        //buffer.appendBuffer(chunk.slice(packet.offset() + 1, packet.next_offset()));
        for(var i = 1; i < packet.size(); i++) {
            var v = chunk.readUInt8(packet.offset() + i);
            os.writeUnsignedLE(v, 8);
        }

        os.align();
        os.end();

        var bs = (this._info.mode_blockflag[mode_number] == 0) ? this._vorb.blocksize0_pow : this._vorb.blocksize1_pow;
        if(this._last_blocksize) {
            this._granpos += Math.floor((this._last_blocksize + bs) / 4);
        }
        this._last_blocksize = bs;

        //console.log(bs, this._granpos);

        var ogg_p = new ogg_packet();
        var packet_buffer = buffer.getBuffer();
        ogg_p.packet = packet_buffer;
        ogg_p.bytes = packet_buffer.length;
        ogg_p.b_o_s = 0;
        ogg_p.e_o_s = ogg_end;
        ogg_p.granulepos = 0; //this._granpos;
        ogg_p.packetno = this._packetno;
        ogg_p.flush = ogg_flush;
        this.push(ogg_p);

        offset = packet.next_offset();
        this._packetno++;
    }
}

Wwriff_Decoder.prototype._read_fmt_chunk = function(chunk) {
    this._fmt = {};
    this._fmt.channels = this._read_16(chunk, 2);
    this._fmt.sample_rate = this._read_32(chunk, 4);
    this._fmt.avg_bps = this._read_32(chunk, 8); //*8
    this._fmt.subtype = this._read_32(chunk, 20);

    //this is usually not part of the fmt chunk, but it happens to be in the files we're dealing with here
    this._vorb = {};
    this._vorb.sample_count = this._read_32(chunk, 24 + 0); //24 is the offset of the vorb data inside the fmt chunk
    this._vorb.mod_signal = this._read_32(chunk, 24 + 4);
    this._vorb.setup_packet_offset = this._read_32(chunk, 24 + 16);
    this._vorb.first_audio_packet_offset = this._read_32(chunk, 24 + 20);
    this._vorb.uid = this._read_32(chunk, 24 + 36);
    this._vorb.blocksize0_pow = chunk.readUInt8(24 + 36 + 4);
    this._vorb.blocksize1_pow = chunk.readUInt8(24 + 36 + 5);

    console.log(this._fmt);
    console.log(this._vorb);
}

Wwriff_Decoder.prototype._read_riff_header = function(header) {
    var riff_head = header.toString('utf8', 0, 4);
    if(riff_head == "RIFX") {
        this._little_endian = false;
        this._read_16 = function(buf, offset) {return buf.readUInt16BE(offset);}
        this._read_32 = function(buf, offset) {return buf.readUInt32BE(offset);}
    } else if(riff_head != 'RIFF') {
        throw new Error('missing RIFF');
    }

    var riff_size = this._read_32(header, 4);

    var wave_head = header.toString('utf8', 8, 12);
    if(wave_head != "WAVE") throw new Error('missing WAVE');
}

module.exports = Wwriff_Decoder;

Wwriff_Decoder.prototype._generateOggPacket1 = function() { //identification packet
    var buffer = new Buffer(23);
    buffer.writeUInt32LE(0, 0); //version
    buffer.writeUInt8(this._fmt.channels, 4); //channels (1byte? dafuq? in the fmt header its 2 bytes O.o)
    buffer.writeUInt32LE(this._fmt.sample_rate, 5); //sample rate
    buffer.writeUInt32LE(0, 9); //bitrate max
    buffer.writeUInt32LE(this._fmt.avg_bps * 8, 13); //bitrate nominal
    buffer.writeUInt32LE(0, 17); //bitrate minimum
    buffer.writeUInt8((this._vorb.blocksize1_pow << 4) | this._vorb.blocksize0_pow, 21); //blocksize1, blocksize0
    buffer.writeUInt8(1, 22);//framing

    var ret = new ogg_packet();
    var packet_buffer = Buffer.concat([generateVorbisPacketHeader(1), buffer]);
    ret.packet = packet_buffer;
    ret.bytes = packet_buffer.length;
    ret.b_o_s = 1;
    ret.e_o_s = 0;
    ret.granulepos = 0;
    ret.packetno = 0;
    return ret;
}

Wwriff_Decoder.prototype._generateOggPacket2 = function() { //comment packet
    var vendor = "Converted from Audiokinetic Wwise by node-wwriff";
    var vendor_length = vendor.length;

    var buffer = new Buffer(4 + vendor_length + 4 + 1);
    buffer.writeUInt32LE(vendor_length, 8);
    buffer.write(vendor, 4, vendor_length, 'ascii');
    buffer.writeUInt32LE(0, 4 + vendor_length); //user comment count
    buffer.writeUInt8(1, 4 + vendor_length + 4); //framing

    var ret = new ogg_packet();
    var packet_buffer = Buffer.concat([generateVorbisPacketHeader(3), buffer]);
    ret.packet = packet_buffer;
    ret.bytes = packet_buffer.length;
    ret.b_o_s = 0;
    ret.e_o_s = 0;
    ret.granulepos = 0;
    ret.packetno = 1;
    ret.flush = false;
    return ret;
}

Wwriff_Decoder.prototype._generateOggPacket3 = function(buf) { //setup packet
    //console.log(this._vorb.setup_packet_offset, this._vorb.first_audio_packet_offset);

    if(buf.length < this._vorb.setup_packet_offset) return null;

    var setup_packet = new Packet(buf, this._vorb.setup_packet_offset, this._little_endian, true);

    if(buf.length < setup_packet.next_offset()) return null;

    var buffer = new StreamBuffer();
    var os = new Bitstream();
    os.pipe(buffer);

    //console.log(setup_packet.offset(), buf.length);

    var is = new BitReadStream(buf);
    is.seekBytes(setup_packet.offset());

    var codebook_count = is.readBits(8) + 1; //we're reading codebook_count_less1
    os.writeUnsignedLE(codebook_count - 1, 8);

    //console.log("codebook count", codebook_count);

    for(var i = 0; i < codebook_count; i++) {
        //read 10 bits
        var codebook_id = is.readBits(10);

        //console.log("Codebook " + i + " = " + codebook_id);

        this._codebook.rebuild(codebook_id, os);
    }

    //console.log("t:", os._total);
    os.writeUnsignedLE(0, 6); //time_count_less1 placeholder
    os.writeUnsignedLE(0, 16); //dummy_time_value

    //floor_count
    var floor_count = is.readBits(6) + 1;
    os.writeUnsignedLE(floor_count - 1, 6);

    //rebuild floors
    for(var i = 0; i < floor_count; i++) {
        os.writeUnsignedLE(1, 16); //always floor type 1

        var floor1_partitions = is.readBits(5);
        os.writeUnsignedLE(floor1_partitions, 5);

        var floor1_partition_class_list = [];
        var maximum_class = 0;

        for(var j = 0; j < floor1_partitions; j++) {
            var floor1_partition_class = is.readBits(4);
            os.writeUnsignedLE(floor1_partition_class, 4);

            floor1_partition_class_list.push(floor1_partition_class);

            if(floor1_partition_class > maximum_class)
                maximum_class = floor1_partition_class;
        }

        var floor1_class_dimensions_list = [];

        for(var j = 0; j <= maximum_class; j++) {
            var class_dimensions_less1 = is.readBits(3);
            os.writeUnsignedLE(class_dimensions_less1, 3);

            floor1_class_dimensions_list.push(class_dimensions_less1 + 1);

            var class_subclasses = is.readBits(2);
            os.writeUnsignedLE(class_subclasses, 2);

            if(0 != class_subclasses) {
                var masterbook = is.readBits(8);
                os.writeUnsignedLE(masterbook, 8);

                if(masterbook > codebook_count) throw new Error("Invalid floor1 masterbook");
            }

            for(var k = 0; k < (1 << class_subclasses); k++) {
                var subclass_book_plus1 = is.readBits(8);
                os.writeUnsignedLE(subclass_book_plus1, 8);

                if(subclass_book_plus1 - 1 >= 0 && subclass_book_plus1 - 1 >= codebook_count) {
                    throw new Error("Invalid floor1 subclass book");
                }
            }
        }

        var floor1_multiplier = is.readBits(2) + 1;
        os.writeUnsignedLE(floor1_multiplier - 1, 2);

        var rangebits = is.readBits(4);
        os.writeUnsignedLE(rangebits, 4);

        for(var j = 0; j < floor1_partitions; j++) {
            var current_class_number = floor1_partition_class_list[j];

            for(var k = 0; k < floor1_class_dimensions_list[current_class_number]; k++) {
                var X = is.readBits(rangebits);
                os.writeUnsignedLE(X, rangebits);
            }
        }


    }

    console.log("rebuild floors", is.getTotalReadBits(), (is.getTotalReadBits() + 7) / 8);
    //console.log("t:", os._total);

    //residue count
    var residue_count = is.readBits(6) + 1;
    os.writeUnsignedLE(residue_count - 1, 6);

    console.log("residue count:", residue_count);

    //rebuild residues
    for(var i = 0; i < residue_count; i++) {
        var residue_type = is.readBits(2);
        os.writeUnsignedLE(residue_type, 16);

        if(residue_type > 2) throw new Error("Invalid residue type");

        var residue_begin = is.readBits(24);
        var residue_end = is.readBits(24);
        var residue_partition_size = is.readBits(24) + 1;
        var residue_classifications = is.readBits(6) + 1;
        var residue_classbook = is.readBits(8);

        os.writeUnsignedLE(residue_begin, 24);
        os.writeUnsignedLE(residue_end, 24);
        os.writeUnsignedLE(residue_partition_size - 1, 24);
        os.writeUnsignedLE(residue_classifications - 1, 6);
        os.writeUnsignedLE(residue_classbook, 8);

        if(residue_classbook >= codebook_count) throw new Error('Invalid residue classbook');

        var residue_cascade = [];

        for(var j = 0; j < residue_classifications; j++) {
            var high_bits = 0;
            var low_bits = is.readBits(3);
            os.writeUnsignedLE(low_bits, 3);
            var bitflag = is.readBits(1);
            os.writeUnsignedLE(bitflag, 1);

            if(bitflag) {
                high_bits = is.readBits(5);
                os.writeUnsignedLE(high_bits, 5);
            }

            residue_cascade.push(high_bits * 8 + low_bits);
        }

        for(var j = 0; j < residue_classifications; j++) {
            for(var k = 0; k < 8; k++) {
                if(residue_cascade[j] & (1 << k)) {
                    var residue_book = is.readBits(8);
                    os.writeUnsignedLE(residue_book, 8);

                    if(residue_book >= codebook_count) throw new Error("Invalid residue book");
                }
            }
        }
    }

    console.log("rebuild residues", is.getTotalReadBits(), (is.getTotalReadBits() + 7) / 8);
    //console.log("t:", os._total);

    //mapping count
    var mapping_count = is.readBits(6) + 1;
    os.writeUnsignedLE(mapping_count - 1, 6);

    console.log("mapping count:", mapping_count);

    for(var i = 0; i < mapping_count; i++) {
        os.writeUnsignedLE(0, 16); //mapping_type is always 0

        var submaps_flag = is.readBits(1);
        os.writeUnsignedLE(submaps_flag, 1);

        var submaps = 1;
        if(submaps_flag) {
            var submaps_less1 = is.readBits(4);
            submaps = submaps_less1 + 1;
            os.writeUnsignedLE(submaps_less1, 4);
        }

        var square_polar_flag = is.readBits(1);
        os.writeUnsignedLE(square_polar_flag, 1);

        if(square_polar_flag) {
            var coupling_steps = is.readBits(8) + 1;
            os.writeUnsignedLE(coupling_steps - 1, 8);

            for(var j = 0; j < coupling_steps; j++) {
                var m_l = ilog(this._fmt.channels - 1);
                var a_l = ilog(this._fmt.channels - 1);

                var magnitude = is.readBits(m_l);
                os.writeUnsignedLE(magnitude, m_l);

                var angle = is.readBits(a_l);
                os.writeUnsignedLE(angle, a_l);

                if(angle == magnitude || magnitude >= this._fmt.channels || angle >= this._fmt.channels) throw new Error('Invalid coupling');
            }
        }

        var mapping_reserved = is.readBits(2);
        os.writeUnsignedLE(mapping_reserved, 2);

        if(mapping_reserved != 0) throw new Error('mapping reserved field nonzero');

        if(submaps > 1) {
            for(var j = 0; j < this._fmt.channels; j++) {
                var mapping_mux = is.readBits(4);
                os.writeUnsignedLE(mapping_mux, 4);

                if(mapping_mux >= submaps) throw new Error("mapping mux >= submaps");
            }
        }

        for(var j = 0; j < submaps; j++) {
            os.writeUnsignedLE(is.readBits(8), 8);

            var floor_number = is.readBits(8);
            os.writeUnsignedLE(floor_number, 8);
            if(floor_number >= floor_count) throw new Error('Invalid floor mapping');

            var residue_number = is.readBits(8);
            os.writeUnsignedLE(residue_number, 8);
            if(residue_number >= residue_count) throw new Error('Invalid residue mapping');
        }
    }

    console.log("mapping count", is.getTotalReadBits(), (is.getTotalReadBits() + 7) / 8);

    //console.log("t:", os._total);

    //mode count
    var mode_count = is.readBits(6) + 1;
    os.writeUnsignedLE(mode_count - 1, 6);

    var mode_blockflag = [];
    var mode_bits = ilog(mode_count - 1);

    this._info.mode_bits = mode_bits;

    for(var i = 0; i < mode_count; i++) {
        var block_flag = is.readBits(1);
        os.writeUnsignedLE(block_flag, 1);

        mode_blockflag.push(block_flag != 0);

        os.writeUnsignedLE(0, 16); //windowtype
        os.writeUnsignedLE(0, 16); //transformtype

        var mapping = is.readBits(8);
        os.writeUnsignedLE(mapping, 8);
        if(mapping > mapping_count) throw new Error('Invalid mode mapping');
    }

    this._info.mode_blockflag = mode_blockflag;

    os.writeUnsignedLE(1, 1); //framing;

    //console.log("t:", os._total);

    os.align();
    os.end();

    //console.log(is.getTotalReadBits(), (is.getTotalReadBits() + 7) / 8, setup_packet.size());
    if(Math.floor((is.getTotalReadBits() + 7) / 8) != setup_packet.size()) throw new Error("Didn't read exactly setup packet");

    var ret = new ogg_packet();
    var packet_buffer = Buffer.concat([generateVorbisPacketHeader(5), buffer.getBuffer()]);
    ret.packet = packet_buffer;
    ret.bytes = packet_buffer.length;
    ret.b_o_s = 0;
    ret.e_o_s = 0;
    ret.granulepos = 0;
    ret.packetno = 2;
    ret.flush = true;
    return ret;
}

function generateVorbisPacketHeader(_type) {
    var type = (_type != undefined) ? _type : 0;
    var ret = new Buffer(7);
    ret.writeUInt8(type, 0);
    ret.write("vorbis", 1);
    return ret;
}

function Packet(buf, _offset, le, _no_granule) {
    var no_granule = (_no_granule != undefined) ? _no_granule : false;

    var offset = _offset;
    var size, abs_granule = 0;

    if(le) { //little endian
        size = buf.readUInt16LE(offset);
        if(!no_granule) abs_granule = buf.readUInt32LE(offset + 2);
    } else {
        size = buf.readUInt16BE(offset);
        if(!no_granule) abs_granule = buf.readUInt32BE(offset + 2);
    }

    this.header_size = function() {return (no_granule) ? 2 : 6}
    this.offset = function() {return offset + this.header_size()}
    this.size = function() {return size}
    this.granule = function() {return abs_granule}
    this.next_offset = function() {return this.offset() + size}
}

function ilog(v) {
    var ret = 0;
    while(v != 0) {
        ret++;
        v = v >> 1;
    }
    return ret;
}
