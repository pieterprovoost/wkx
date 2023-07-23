function encode (value) {
    return (value << 1) ^ (value >> 31);
}

function decode (value) {
    return (value >> 1) ^ (-(value & 1));
}

export default { encode, decode };