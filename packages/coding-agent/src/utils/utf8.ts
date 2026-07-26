/**
 * Drop a trailing UTF-8 sequence that a byte-level cut left incomplete, so decoding the result
 * cannot end in U+FFFD.
 *
 * Works on the bytes rather than on the decoded string: stripping a trailing U+FFFD after decoding
 * cannot tell a decoder artifact apart from a replacement character the data genuinely contained.
 */
export function trimIncompleteTrailingUtf8(buffer: Buffer): Buffer {
	for (let back = 1; back <= 3 && back <= buffer.length; back++) {
		const index = buffer.length - back;
		const byte = buffer[index];
		// Continuation byte: the sequence starts further back.
		if ((byte & 0xc0) === 0x80) continue;
		const sequenceLength = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
		return sequenceLength > back ? buffer.subarray(0, index) : buffer;
	}
	return buffer;
}
