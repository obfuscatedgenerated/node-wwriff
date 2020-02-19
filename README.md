node-wwriff
===========

A port of [ww2ogg](https://github.com/hcs64/ww2ogg). Provides a streaming decoder for Audiokinetik Wwise files to ogg packets.

## Installation
    npm install node-wwriff

## Example
```javascript
const fs = require('fs');
const ogg = require('ogg');
const { Decoder } = require('node-wwriff');

const encoder = new ogg.Encoder();
const decoder = new Decoder();
decoder.setCodebook("path_to_external_codebooks.bin");

fs.createReadStream("file.wem").pipe(decoder).pipe(encoder.stream());
encoder.pipe(fs.createWriteStream("file.ogg"));
```

See the `examples` directory for some example code.

## API

### Decoder class
The `Decoder` class is a `Writable` and `Readable` stream that accepts an wem file written to it and emits `ogg_packet` instances. These need to be piped into and `ogg.Encoder`.

## Notes

This project is by no means a complete port of `ww2ogg` and lacks a lot of features (PRs welcome 😉), especially support for inline codebooks. It was also only tested with audio files from *The Witcher 3: Wild Hunt* and is probably incompatible with a lot of other files.