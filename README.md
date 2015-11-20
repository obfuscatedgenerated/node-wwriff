node-wwriff
===========

A port of [ww2ogg](https://github.com/hcs64/ww2ogg). Provides a streaming decoder for Audiokinetik Wwise files to ogg packets.

## Installation
    npm install node-wwriff

## Example
```
var fs = require('fs');
var ogg = require('ogg');
var Wwriff_Decoder = require('node-wwriff').Decoder;

var encoder = new ogg.Encoder();
var decoder = new Wwriff_Decoder();
decoder.setCodebook("path_to_external_codebooks.bin");

fs.createReadStream("file.wem").pipe(decoder).pipe(encoder.stream());
encoder.pipe(fs.createWriteStream("file.ogg"));
```

See the `examples` directory for some example code.

## API

### Decoder class
The `Decoder` class is a `Writable` and `Readable` stream that accepts an wem file written to it and emits `ogg_packet` instances. These need to be piped into and `ogg.Encoder`.

## Notes

This project is by no means a complete port of `ww2ogg` and lacks a lot of features, especially support for inline codebooks. It was also only tested with audio files from *The Witcher 3: Wild Hunt* and is probably incompatible with most other files.

The code quality is also very low and is in need of refractoring.

At the time of writing this (Nov 2015) `npm install ogg` will not work, because Nate hasn't updated it in npm. The version on github works thought, so just doing `npm install git+https://github.com/TooTallNate/node-ogg.git` and install it directly from there does work.
