
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const ALPHABET_MAP: { [key: string]: number } = {};
for (let i = 0; i < ALPHABET.length; i++) {
    ALPHABET_MAP[ALPHABET.charAt(i)] = i;
}

export function decodeBase58(string: string): Uint8Array {
    if (string.length === 0) return new Uint8Array(0);
    let i, j, bytes = [0];
    for (i = 0; i < string.length; i++) {
        const c = string[i];
        if (!(c in ALPHABET_MAP)) throw new Error('Non-base58 character');
        for (j = 0; j < bytes.length; j++) bytes[j] *= 58;
        bytes[0] += ALPHABET_MAP[c];
        let carry = 0;
        for (j = 0; j < bytes.length; ++j) {
            bytes[j] += carry;
            carry = bytes[j] >> 8;
            bytes[j] &= 0xff;
        }
        while (carry) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }
    for (i = 0; i < string.length && string[i] === '1'; i++) bytes.push(0);
    return new Uint8Array(bytes.reverse());
}
