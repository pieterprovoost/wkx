import Types from "./types.js";
import ZigZag from "./zigzag.js";
import { Buffer } from "buffer";

function BinaryReader(buffer, isBigEndian) {
    this.buffer = buffer;
    this.position = 0;
    this.isBigEndian = isBigEndian || false;
}

function _read(readLE, readBE, size) {
    return function () {
        var value;

        if (this.isBigEndian)
            value = readBE.call(this.buffer, this.position);
        else
            value = readLE.call(this.buffer, this.position);

        this.position += size;

        return value;
    };
}

BinaryReader.prototype.readUInt8 = _read(Buffer.prototype.readUInt8, Buffer.prototype.readUInt8, 1);
BinaryReader.prototype.readUInt16 = _read(Buffer.prototype.readUInt16LE, Buffer.prototype.readUInt16BE, 2);
BinaryReader.prototype.readUInt32 = _read(Buffer.prototype.readUInt32LE, Buffer.prototype.readUInt32BE, 4);
BinaryReader.prototype.readInt8 = _read(Buffer.prototype.readInt8, Buffer.prototype.readInt8, 1);
BinaryReader.prototype.readInt16 = _read(Buffer.prototype.readInt16LE, Buffer.prototype.readInt16BE, 2);
BinaryReader.prototype.readInt32 = _read(Buffer.prototype.readInt32LE, Buffer.prototype.readInt32BE, 4);
BinaryReader.prototype.readFloat = _read(Buffer.prototype.readFloatLE, Buffer.prototype.readFloatBE, 4);
BinaryReader.prototype.readDouble = _read(Buffer.prototype.readDoubleLE, Buffer.prototype.readDoubleBE, 8);

BinaryReader.prototype.readVarInt = function () {
    var nextByte,
        result = 0,
        bytesRead = 0;

    do {
        nextByte = this.buffer[this.position + bytesRead];
        result += (nextByte & 0x7F) << (7 * bytesRead);
        bytesRead++;
    } while (nextByte >= 0x80);

    this.position += bytesRead;

    return result;
};

function BinaryWriter(size, allowResize) {
    this.buffer = new Buffer(size);
    this.position = 0;
    this.allowResize = allowResize;
}

function _write(write, size) {
    return function (value, noAssert) {
        this.ensureSize(size);

        write.call(this.buffer, value, this.position, noAssert);
        this.position += size;
    };
}

BinaryWriter.prototype.writeUInt8 = _write(Buffer.prototype.writeUInt8, 1);
BinaryWriter.prototype.writeUInt16LE = _write(Buffer.prototype.writeUInt16LE, 2);
BinaryWriter.prototype.writeUInt16BE = _write(Buffer.prototype.writeUInt16BE, 2);
BinaryWriter.prototype.writeUInt32LE = _write(Buffer.prototype.writeUInt32LE, 4);
BinaryWriter.prototype.writeUInt32BE = _write(Buffer.prototype.writeUInt32BE, 4);
BinaryWriter.prototype.writeInt8 = _write(Buffer.prototype.writeInt8, 1);
BinaryWriter.prototype.writeInt16LE = _write(Buffer.prototype.writeInt16LE, 2);
BinaryWriter.prototype.writeInt16BE = _write(Buffer.prototype.writeInt16BE, 2);
BinaryWriter.prototype.writeInt32LE = _write(Buffer.prototype.writeInt32LE, 4);
BinaryWriter.prototype.writeInt32BE = _write(Buffer.prototype.writeInt32BE, 4);
BinaryWriter.prototype.writeFloatLE = _write(Buffer.prototype.writeFloatLE, 4);
BinaryWriter.prototype.writeFloatBE = _write(Buffer.prototype.writeFloatBE, 4);
BinaryWriter.prototype.writeDoubleLE = _write(Buffer.prototype.writeDoubleLE, 8);
BinaryWriter.prototype.writeDoubleBE = _write(Buffer.prototype.writeDoubleBE, 8);

BinaryWriter.prototype.writeBuffer = function (buffer) {
    this.ensureSize(buffer.length);

    buffer.copy(this.buffer, this.position, 0, buffer.length);
    this.position += buffer.length;
};

BinaryWriter.prototype.writeVarInt = function (value) {
    var length = 1;

    while ((value & 0xFFFFFF80) !== 0) {
        this.writeUInt8((value & 0x7F) | 0x80);
        value >>>= 7;
        length++;
    }

    this.writeUInt8(value & 0x7F);

    return length;
};

BinaryWriter.prototype.ensureSize = function (size) {
    if (this.buffer.length < this.position + size) {
        if (this.allowResize) {
            var tempBuffer = new Buffer(this.position + size);
            this.buffer.copy(tempBuffer, 0, 0, this.buffer.length);
            this.buffer = tempBuffer;
        }
        else {
            throw new RangeError('index out of range');
        }
    }
};

function Geometry() {
    this.srid = undefined;
    this.hasZ = false;
    this.hasM = false;
}

Geometry.parse = function (value, options) {
    var valueType = typeof value;

    if (valueType === 'string' || value instanceof WktParser)
        return Geometry._parseWkt(value);
    else if (Buffer.isBuffer(value) || value instanceof BinaryReader)
        return Geometry._parseWkb(value, options);
    else
        throw new Error('first argument must be a string or Buffer');
};

Geometry._parseWkt = function (value) {
    var wktParser,
        srid;

    if (value instanceof WktParser)
        wktParser = value;
    else
        wktParser = new WktParser(value);

    var match = wktParser.matchRegex([/^SRID=(\d+);/]);
    if (match)
        srid = parseInt(match[1], 10);

    var geometryType = wktParser.matchType();
    var dimension = wktParser.matchDimension();

    var options = {
        srid: srid,
        hasZ: dimension.hasZ,
        hasM: dimension.hasM
    };

    switch (geometryType) {
        case Types.wkt.Point:
            return Point._parseWkt(wktParser, options);
        case Types.wkt.LineString:
            return LineString._parseWkt(wktParser, options);
        case Types.wkt.Polygon:
            return Polygon._parseWkt(wktParser, options);
        case Types.wkt.MultiPoint:
            return MultiPoint._parseWkt(wktParser, options);
        case Types.wkt.MultiLineString:
            return MultiLineString._parseWkt(wktParser, options);
        case Types.wkt.MultiPolygon:
            return MultiPolygon._parseWkt(wktParser, options);
        case Types.wkt.GeometryCollection:
            return GeometryCollection._parseWkt(wktParser, options);
    }
};

Geometry._parseWkb = function (value, parentOptions) {
    var binaryReader,
        wkbType,
        geometryType,
        options = {};

    if (value instanceof BinaryReader)
        binaryReader = value;
    else
        binaryReader = new BinaryReader(value);

    binaryReader.isBigEndian = !binaryReader.readInt8();

    wkbType = binaryReader.readUInt32();

    options.hasSrid = (wkbType & 0x20000000) === 0x20000000;
    options.isEwkb = (wkbType & 0x20000000) || (wkbType & 0x40000000) || (wkbType & 0x80000000);

    if (options.hasSrid)
        options.srid = binaryReader.readUInt32();

    options.hasZ = false;
    options.hasM = false;

    if (!options.isEwkb && (!parentOptions || !parentOptions.isEwkb)) {
        if (wkbType >= 1000 && wkbType < 2000) {
            options.hasZ = true;
            geometryType = wkbType - 1000;
        }
        else if (wkbType >= 2000 && wkbType < 3000) {
            options.hasM = true;
            geometryType = wkbType - 2000;
        }
        else if (wkbType >= 3000 && wkbType < 4000) {
            options.hasZ = true;
            options.hasM = true;
            geometryType = wkbType - 3000;
        }
        else {
            geometryType = wkbType;
        }
    }
    else {
        if (wkbType & 0x80000000)
            options.hasZ = true;
        if (wkbType & 0x40000000)
            options.hasM = true;

        geometryType = wkbType & 0xF;
    }

    switch (geometryType) {
        case Types.wkb.Point:
            return Point._parseWkb(binaryReader, options);
        case Types.wkb.LineString:
            return LineString._parseWkb(binaryReader, options);
        case Types.wkb.Polygon:
            return Polygon._parseWkb(binaryReader, options);
        case Types.wkb.MultiPoint:
            return MultiPoint._parseWkb(binaryReader, options);
        case Types.wkb.MultiLineString:
            return MultiLineString._parseWkb(binaryReader, options);
        case Types.wkb.MultiPolygon:
            return MultiPolygon._parseWkb(binaryReader, options);
        case Types.wkb.GeometryCollection:
            return GeometryCollection._parseWkb(binaryReader, options);
        default:
            throw new Error('GeometryType ' + geometryType + ' not supported');
    }
};

Geometry.parseTwkb = function (value) {
    var binaryReader,
        options = {};

    if (value instanceof BinaryReader)
        binaryReader = value;
    else
        binaryReader = new BinaryReader(value);

    var type = binaryReader.readUInt8();
    var metadataHeader = binaryReader.readUInt8();

    var geometryType = type & 0x0F;
    options.precision = ZigZag.decode(type >> 4);
    options.precisionFactor = Math.pow(10, options.precision);

    options.hasBoundingBox = metadataHeader >> 0 & 1;
    options.hasSizeAttribute = metadataHeader >> 1 & 1;
    options.hasIdList = metadataHeader >> 2 & 1;
    options.hasExtendedPrecision = metadataHeader >> 3 & 1;
    options.isEmpty = metadataHeader >> 4 & 1;

    if (options.hasExtendedPrecision) {
        var extendedPrecision = binaryReader.readUInt8();
        options.hasZ = (extendedPrecision & 0x01) === 0x01;
        options.hasM = (extendedPrecision & 0x02) === 0x02;

        options.zPrecision = ZigZag.decode((extendedPrecision & 0x1C) >> 2);
        options.zPrecisionFactor = Math.pow(10, options.zPrecision);

        options.mPrecision = ZigZag.decode((extendedPrecision & 0xE0) >> 5);
        options.mPrecisionFactor = Math.pow(10, options.mPrecision);
    }
    else {
        options.hasZ = false;
        options.hasM = false;
    }

    if (options.hasSizeAttribute)
        binaryReader.readVarInt();
    if (options.hasBoundingBox) {
        var dimensions = 2;

        if (options.hasZ)
            dimensions++;
        if (options.hasM)
            dimensions++;

        for (var i = 0; i < dimensions; i++) {
            binaryReader.readVarInt();
            binaryReader.readVarInt();
        }
    }

    switch (geometryType) {
        case Types.wkb.Point:
            return Point._parseTwkb(binaryReader, options);
        case Types.wkb.LineString:
            return LineString._parseTwkb(binaryReader, options);
        case Types.wkb.Polygon:
            return Polygon._parseTwkb(binaryReader, options);
        case Types.wkb.MultiPoint:
            return MultiPoint._parseTwkb(binaryReader, options);
        case Types.wkb.MultiLineString:
            return MultiLineString._parseTwkb(binaryReader, options);
        case Types.wkb.MultiPolygon:
            return MultiPolygon._parseTwkb(binaryReader, options);
        case Types.wkb.GeometryCollection:
            return GeometryCollection._parseTwkb(binaryReader, options);
        default:
            throw new Error('GeometryType ' + geometryType + ' not supported');
    }
};

Geometry.parseGeoJSON = function (value) {
    return Geometry._parseGeoJSON(value);
};

Geometry._parseGeoJSON = function (value, isSubGeometry) {
    var geometry;

    switch (value.type) {
        case Types.geoJSON.Point:
            geometry = Point._parseGeoJSON(value); break;
        case Types.geoJSON.LineString:
            geometry = LineString._parseGeoJSON(value); break;
        case Types.geoJSON.Polygon:
            geometry = Polygon._parseGeoJSON(value); break;
        case Types.geoJSON.MultiPoint:
            geometry = MultiPoint._parseGeoJSON(value); break;
        case Types.geoJSON.MultiLineString:
            geometry = MultiLineString._parseGeoJSON(value); break;
        case Types.geoJSON.MultiPolygon:
            geometry = MultiPolygon._parseGeoJSON(value); break;
        case Types.geoJSON.GeometryCollection:
            geometry = GeometryCollection._parseGeoJSON(value); break;
        default:
            throw new Error('GeometryType ' + value.type + ' not supported');
    }

    if (value.crs && value.crs.type && value.crs.type === 'name' && value.crs.properties && value.crs.properties.name) {
        var crs = value.crs.properties.name;

        if (crs.indexOf('EPSG:') === 0)
            geometry.srid = parseInt(crs.substring(5));
        else if (crs.indexOf('urn:ogc:def:crs:EPSG::') === 0)
            geometry.srid = parseInt(crs.substring(22));
        else
            throw new Error('Unsupported crs: ' + crs);
    }
    else if (!isSubGeometry) {
        geometry.srid = 4326;
    }

    return geometry;
};

Geometry.prototype.toEwkt = function () {
    return 'SRID=' + this.srid + ';' + this.toWkt();
};

Geometry.prototype.toEwkb = function () {
    var ewkb = new BinaryWriter(this._getWkbSize() + 4);
    var wkb = this.toWkb();

    ewkb.writeInt8(1);
    ewkb.writeUInt32LE((wkb.slice(1, 5).readUInt32LE(0) | 0x20000000) >>> 0, true);
    ewkb.writeUInt32LE(this.srid);

    ewkb.writeBuffer(wkb.slice(5));

    return ewkb.buffer;
};

Geometry.prototype._getWktType = function (wktType, isEmpty) {
    var wkt = wktType;

    if (this.hasZ && this.hasM)
        wkt += ' ZM ';
    else if (this.hasZ)
        wkt += ' Z ';
    else if (this.hasM)
        wkt += ' M ';

    if (isEmpty && !this.hasZ && !this.hasM)
        wkt += ' ';

    if (isEmpty)
        wkt += 'EMPTY';

    return wkt;
};

Geometry.prototype._getWktCoordinate = function (point) {
    var coordinates = point.x + ' ' + point.y;

    if (this.hasZ)
        coordinates += ' ' + point.z;
    if (this.hasM)
        coordinates += ' ' + point.m;

    return coordinates;
};

Geometry.prototype._writeWkbType = function (wkb, geometryType, parentOptions) {
    var dimensionType = 0;

    if (typeof this.srid === 'undefined' && (!parentOptions || typeof parentOptions.srid === 'undefined')) {
        if (this.hasZ && this.hasM)
            dimensionType += 3000;
        else if (this.hasZ)
            dimensionType += 1000;
        else if (this.hasM)
            dimensionType += 2000;
    }
    else {
        if (this.hasZ)
            dimensionType |= 0x80000000;
        if (this.hasM)
            dimensionType |= 0x40000000;
    }

    wkb.writeUInt32LE((dimensionType + geometryType) >>> 0, true);
};

Geometry.getTwkbPrecision = function (xyPrecision, zPrecision, mPrecision) {
    return {
        xy: xyPrecision,
        z: zPrecision,
        m: mPrecision,
        xyFactor: Math.pow(10, xyPrecision),
        zFactor: Math.pow(10, zPrecision),
        mFactor: Math.pow(10, mPrecision)
    };
};

Geometry.prototype._writeTwkbHeader = function (twkb, geometryType, precision, isEmpty) {
    var type = (ZigZag.encode(precision.xy) << 4) + geometryType;
    var metadataHeader = (this.hasZ || this.hasM) << 3;
    metadataHeader += isEmpty << 4;

    twkb.writeUInt8(type);
    twkb.writeUInt8(metadataHeader);

    if (this.hasZ || this.hasM) {
        var extendedPrecision = 0;
        if (this.hasZ)
            extendedPrecision |= 0x1;
        if (this.hasM)
            extendedPrecision |= 0x2;

        twkb.writeUInt8(extendedPrecision);
    }
};

Geometry.prototype.toGeoJSON = function (options) {
    var geoJSON = {};

    if (this.srid) {
        if (options) {
            if (options.shortCrs) {
                geoJSON.crs = {
                    type: 'name',
                    properties: {
                        name: 'EPSG:' + this.srid
                    }
                };
            }
            else if (options.longCrs) {
                geoJSON.crs = {
                    type: 'name',
                    properties: {
                        name: 'urn:ogc:def:crs:EPSG::' + this.srid
                    }
                };
            }
        }
    }

    return geoJSON;
};

function GeometryCollection(geometries, srid) {
    Geometry.call(this);

    this.geometries = geometries || [];
	this.srid = srid;

    if (this.geometries.length > 0) {
        this.hasZ = this.geometries[0].hasZ;
        this.hasM = this.geometries[0].hasM;
    }
}

inherits(GeometryCollection, Geometry);

GeometryCollection.Z = function (geometries, srid) {
    var geometryCollection = new GeometryCollection(geometries, srid);
    geometryCollection.hasZ = true;
    return geometryCollection;
};

GeometryCollection.M = function (geometries, srid) {
    var geometryCollection = new GeometryCollection(geometries, srid);
    geometryCollection.hasM = true;
    return geometryCollection;
};

GeometryCollection.ZM = function (geometries, srid) {
    var geometryCollection = new GeometryCollection(geometries, srid);
    geometryCollection.hasZ = true;
    geometryCollection.hasM = true;
    return geometryCollection;
};

GeometryCollection._parseWkt = function (value, options) {
    var geometryCollection = new GeometryCollection();
    geometryCollection.srid = options.srid;
    geometryCollection.hasZ = options.hasZ;
    geometryCollection.hasM = options.hasM;

    if (value.isMatch(['EMPTY']))
        return geometryCollection;

    value.expectGroupStart();

    do {
        geometryCollection.geometries.push(Geometry.parse(value));
    } while (value.isMatch([',']));

    value.expectGroupEnd();

    return geometryCollection;
};

GeometryCollection._parseWkb = function (value, options) {
    var geometryCollection = new GeometryCollection();
    geometryCollection.srid = options.srid;
    geometryCollection.hasZ = options.hasZ;
    geometryCollection.hasM = options.hasM;

    var geometryCount = value.readUInt32();

    for (var i = 0; i < geometryCount; i++)
        geometryCollection.geometries.push(Geometry.parse(value, options));

    return geometryCollection;
};

GeometryCollection._parseTwkb = function (value, options) {
    var geometryCollection = new GeometryCollection();
    geometryCollection.hasZ = options.hasZ;
    geometryCollection.hasM = options.hasM;

    if (options.isEmpty)
        return geometryCollection;

    var geometryCount = value.readVarInt();

    for (var i = 0; i < geometryCount; i++)
        geometryCollection.geometries.push(Geometry.parseTwkb(value));

    return geometryCollection;
};

GeometryCollection._parseGeoJSON = function (value) {
    var geometryCollection = new GeometryCollection();

    for (var i = 0; i < value.geometries.length; i++)
        geometryCollection.geometries.push(Geometry._parseGeoJSON(value.geometries[i], true));

    if (geometryCollection.geometries.length > 0)
        geometryCollection.hasZ = geometryCollection.geometries[0].hasZ;

    return geometryCollection;
};

GeometryCollection.prototype.toWkt = function () {
    if (this.geometries.length === 0)
        return this._getWktType(Types.wkt.GeometryCollection, true);

    var wkt = this._getWktType(Types.wkt.GeometryCollection, false) + '(';

    for (var i = 0; i < this.geometries.length; i++)
        wkt += this.geometries[i].toWkt() + ',';

    wkt = wkt.slice(0, -1);
    wkt += ')';

    return wkt;
};

GeometryCollection.prototype.toWkb = function () {
    var wkb = new BinaryWriter(this._getWkbSize());

    wkb.writeInt8(1);

    this._writeWkbType(wkb, Types.wkb.GeometryCollection);
    wkb.writeUInt32LE(this.geometries.length);

    for (var i = 0; i < this.geometries.length; i++)
        wkb.writeBuffer(this.geometries[i].toWkb({ srid: this.srid }));

    return wkb.buffer;
};

GeometryCollection.prototype.toTwkb = function () {
    var twkb = new BinaryWriter(0, true);

    var precision = Geometry.getTwkbPrecision(5, 0, 0);
    var isEmpty = this.geometries.length === 0;

    this._writeTwkbHeader(twkb, Types.wkb.GeometryCollection, precision, isEmpty);

    if (this.geometries.length > 0) {
        twkb.writeVarInt(this.geometries.length);

        for (var i = 0; i < this.geometries.length; i++)
            twkb.writeBuffer(this.geometries[i].toTwkb());
    }

    return twkb.buffer;
};

GeometryCollection.prototype._getWkbSize = function () {
    var size = 1 + 4 + 4;

    for (var i = 0; i < this.geometries.length; i++)
        size += this.geometries[i]._getWkbSize();

    return size;
};

GeometryCollection.prototype.toGeoJSON = function (options) {
    var geoJSON = Geometry.prototype.toGeoJSON.call(this, options);
    geoJSON.type = Types.geoJSON.GeometryCollection;
    geoJSON.geometries = [];

    for (var i = 0; i < this.geometries.length; i++)
        geoJSON.geometries.push(this.geometries[i].toGeoJSON());

    return geoJSON;
};

function LineString(points, srid) {
    Geometry.call(this);

    this.points = points || [];
	this.srid = srid;

    if (this.points.length > 0) {
        this.hasZ = this.points[0].hasZ;
        this.hasM = this.points[0].hasM;
    }
}

inherits(LineString, Geometry);

LineString.Z = function (points, srid) {
    var lineString = new LineString(points, srid);
    lineString.hasZ = true;
    return lineString;
};

LineString.M = function (points, srid) {
    var lineString = new LineString(points, srid);
    lineString.hasM = true;
    return lineString;
};

LineString.ZM = function (points, srid) {
    var lineString = new LineString(points, srid);
    lineString.hasZ = true;
    lineString.hasM = true;
    return lineString;
};

LineString._parseWkt = function (value, options) {
    var lineString = new LineString();
    lineString.srid = options.srid;
    lineString.hasZ = options.hasZ;
    lineString.hasM = options.hasM;

    if (value.isMatch(['EMPTY']))
        return lineString;

    value.expectGroupStart();
    lineString.points.push.apply(lineString.points, value.matchCoordinates(options));
    value.expectGroupEnd();

    return lineString;
};

LineString._parseWkb = function (value, options) {
    var lineString = new LineString();
    lineString.srid = options.srid;
    lineString.hasZ = options.hasZ;
    lineString.hasM = options.hasM;

    var pointCount = value.readUInt32();

    for (var i = 0; i < pointCount; i++)
        lineString.points.push(Point._readWkbPoint(value, options));

    return lineString;
};

LineString._parseTwkb = function (value, options) {
    var lineString = new LineString();
    lineString.hasZ = options.hasZ;
    lineString.hasM = options.hasM;

    if (options.isEmpty)
        return lineString;

    var previousPoint = new Point(0, 0, options.hasZ ? 0 : undefined, options.hasM ? 0 : undefined);
    var pointCount = value.readVarInt();

    for (var i = 0; i < pointCount; i++)
        lineString.points.push(Point._readTwkbPoint(value, options, previousPoint));

    return lineString;
};

LineString._parseGeoJSON = function (value) {
    var lineString = new LineString();

    if (value.coordinates.length > 0)
        lineString.hasZ = value.coordinates[0].length > 2;

    for (var i = 0; i < value.coordinates.length; i++)
        lineString.points.push(Point._readGeoJSONPoint(value.coordinates[i]));

    return lineString;
};

LineString.prototype.toWkt = function () {
    if (this.points.length === 0)
        return this._getWktType(Types.wkt.LineString, true);

    return this._getWktType(Types.wkt.LineString, false) + this._toInnerWkt();
};

LineString.prototype._toInnerWkt = function () {
    var innerWkt = '(';

    for (var i = 0; i < this.points.length; i++)
        innerWkt += this._getWktCoordinate(this.points[i]) + ',';

    innerWkt = innerWkt.slice(0, -1);
    innerWkt += ')';

    return innerWkt;
};

LineString.prototype.toWkb = function (parentOptions) {
    var wkb = new BinaryWriter(this._getWkbSize());

    wkb.writeInt8(1);

    this._writeWkbType(wkb, Types.wkb.LineString, parentOptions);
    wkb.writeUInt32LE(this.points.length);

    for (var i = 0; i < this.points.length; i++)
        this.points[i]._writeWkbPoint(wkb);

    return wkb.buffer;
};

LineString.prototype.toTwkb = function () {
    var twkb = new BinaryWriter(0, true);

    var precision = Geometry.getTwkbPrecision(5, 0, 0);
    var isEmpty = this.points.length === 0;

    this._writeTwkbHeader(twkb, Types.wkb.LineString, precision, isEmpty);

    if (this.points.length > 0) {
        twkb.writeVarInt(this.points.length);

        var previousPoint = new Point(0, 0, 0, 0);
        for (var i = 0; i < this.points.length; i++)
            this.points[i]._writeTwkbPoint(twkb, precision, previousPoint);
    }

    return twkb.buffer;
};

LineString.prototype._getWkbSize = function () {
    var coordinateSize = 16;

    if (this.hasZ)
        coordinateSize += 8;
    if (this.hasM)
        coordinateSize += 8;

    return 1 + 4 + 4 + (this.points.length * coordinateSize);
};

LineString.prototype.toGeoJSON = function (options) {
    var geoJSON = Geometry.prototype.toGeoJSON.call(this, options);
    geoJSON.type = Types.geoJSON.LineString;
    geoJSON.coordinates = [];

    for (var i = 0; i < this.points.length; i++) {
        if (this.hasZ)
            geoJSON.coordinates.push([this.points[i].x, this.points[i].y, this.points[i].z]);
        else
            geoJSON.coordinates.push([this.points[i].x, this.points[i].y]);
    }

    return geoJSON;
};

function MultiLineString(lineStrings, srid) {
    Geometry.call(this);

    this.lineStrings = lineStrings || [];
	this.srid = srid;

    if (this.lineStrings.length > 0) {
        this.hasZ = this.lineStrings[0].hasZ;
        this.hasM = this.lineStrings[0].hasM;
    }
}

inherits(MultiLineString, Geometry);

MultiLineString.Z = function (lineStrings, srid) {
    var multiLineString = new MultiLineString(lineStrings, srid);
    multiLineString.hasZ = true;
    return multiLineString;
};

MultiLineString.M = function (lineStrings, srid) {
    var multiLineString = new MultiLineString(lineStrings, srid);
    multiLineString.hasM = true;
    return multiLineString;
};

MultiLineString.ZM = function (lineStrings, srid) {
    var multiLineString = new MultiLineString(lineStrings, srid);
    multiLineString.hasZ = true;
    multiLineString.hasM = true;
    return multiLineString;
};

MultiLineString._parseWkt = function (value, options) {
    var multiLineString = new MultiLineString();
    multiLineString.srid = options.srid;
    multiLineString.hasZ = options.hasZ;
    multiLineString.hasM = options.hasM;

    if (value.isMatch(['EMPTY']))
        return multiLineString;

    value.expectGroupStart();

    do {
        value.expectGroupStart();
        multiLineString.lineStrings.push(new LineString(value.matchCoordinates(options)));
        value.expectGroupEnd();
    } while (value.isMatch([',']));

    value.expectGroupEnd();

    return multiLineString;
};

MultiLineString._parseWkb = function (value, options) {
    var multiLineString = new MultiLineString();
    multiLineString.srid = options.srid;
    multiLineString.hasZ = options.hasZ;
    multiLineString.hasM = options.hasM;

    var lineStringCount = value.readUInt32();

    for (var i = 0; i < lineStringCount; i++)
        multiLineString.lineStrings.push(Geometry.parse(value, options));

    return multiLineString;
};

MultiLineString._parseTwkb = function (value, options) {
    var multiLineString = new MultiLineString();
    multiLineString.hasZ = options.hasZ;
    multiLineString.hasM = options.hasM;

    if (options.isEmpty)
        return multiLineString;

    var previousPoint = new Point(0, 0, options.hasZ ? 0 : undefined, options.hasM ? 0 : undefined);
    var lineStringCount = value.readVarInt();

    for (var i = 0; i < lineStringCount; i++) {
        var lineString = new LineString();
        lineString.hasZ = options.hasZ;
        lineString.hasM = options.hasM;

        var pointCount = value.readVarInt();

        for (var j = 0; j < pointCount; j++)
            lineString.points.push(Point._readTwkbPoint(value, options, previousPoint));

        multiLineString.lineStrings.push(lineString);
    }

    return multiLineString;
};

MultiLineString._parseGeoJSON = function (value) {
    var multiLineString = new MultiLineString();

    if (value.coordinates.length > 0 && value.coordinates[0].length > 0)
        multiLineString.hasZ = value.coordinates[0][0].length > 2;

    for (var i = 0; i < value.coordinates.length; i++)
        multiLineString.lineStrings.push(LineString._parseGeoJSON({ coordinates: value.coordinates[i] }));

    return multiLineString;
};

MultiLineString.prototype.toWkt = function () {
    if (this.lineStrings.length === 0)
        return this._getWktType(Types.wkt.MultiLineString, true);

    var wkt = this._getWktType(Types.wkt.MultiLineString, false) + '(';

    for (var i = 0; i < this.lineStrings.length; i++)
        wkt += this.lineStrings[i]._toInnerWkt() + ',';

    wkt = wkt.slice(0, -1);
    wkt += ')';

    return wkt;
};

MultiLineString.prototype.toWkb = function () {
    var wkb = new BinaryWriter(this._getWkbSize());

    wkb.writeInt8(1);

    this._writeWkbType(wkb, Types.wkb.MultiLineString);
    wkb.writeUInt32LE(this.lineStrings.length);

    for (var i = 0; i < this.lineStrings.length; i++)
        wkb.writeBuffer(this.lineStrings[i].toWkb({ srid: this.srid }));

    return wkb.buffer;
};

MultiLineString.prototype.toTwkb = function () {
    var twkb = new BinaryWriter(0, true);

    var precision = Geometry.getTwkbPrecision(5, 0, 0);
    var isEmpty = this.lineStrings.length === 0;

    this._writeTwkbHeader(twkb, Types.wkb.MultiLineString, precision, isEmpty);

    if (this.lineStrings.length > 0) {
        twkb.writeVarInt(this.lineStrings.length);

        var previousPoint = new Point(0, 0, 0, 0);
        for (var i = 0; i < this.lineStrings.length; i++) {
            twkb.writeVarInt(this.lineStrings[i].points.length);

            for (var j = 0; j < this.lineStrings[i].points.length; j++)
                this.lineStrings[i].points[j]._writeTwkbPoint(twkb, precision, previousPoint);
        }
    }

    return twkb.buffer;
};

MultiLineString.prototype._getWkbSize = function () {
    var size = 1 + 4 + 4;

    for (var i = 0; i < this.lineStrings.length; i++)
        size += this.lineStrings[i]._getWkbSize();

    return size;
};

MultiLineString.prototype.toGeoJSON = function (options) {
    var geoJSON = Geometry.prototype.toGeoJSON.call(this, options);
    geoJSON.type = Types.geoJSON.MultiLineString;
    geoJSON.coordinates = [];

    for (var i = 0; i < this.lineStrings.length; i++)
        geoJSON.coordinates.push(this.lineStrings[i].toGeoJSON().coordinates);

    return geoJSON;
};

function MultiPoint(points, srid) {
    Geometry.call(this);

    this.points = points || [];
	this.srid = srid;

    if (this.points.length > 0) {
        this.hasZ = this.points[0].hasZ;
        this.hasM = this.points[0].hasM;
    }
}

inherits(MultiPoint, Geometry);

MultiPoint.Z = function (points, srid) {
    var multiPoint = new MultiPoint(points, srid);
    multiPoint.hasZ = true;
    return multiPoint;
};

MultiPoint.M = function (points, srid) {
    var multiPoint = new MultiPoint(points, srid);
    multiPoint.hasM = true;
    return multiPoint;
};

MultiPoint.ZM = function (points, srid) {
    var multiPoint = new MultiPoint(points, srid);
    multiPoint.hasZ = true;
    multiPoint.hasM = true;
    return multiPoint;
};

MultiPoint._parseWkt = function (value, options) {
    var multiPoint = new MultiPoint();
    multiPoint.srid = options.srid;
    multiPoint.hasZ = options.hasZ;
    multiPoint.hasM = options.hasM;

    if (value.isMatch(['EMPTY']))
        return multiPoint;

    value.expectGroupStart();
    multiPoint.points.push.apply(multiPoint.points, value.matchCoordinates(options));
    value.expectGroupEnd();

    return multiPoint;
};

MultiPoint._parseWkb = function (value, options) {
    var multiPoint = new MultiPoint();
    multiPoint.srid = options.srid;
    multiPoint.hasZ = options.hasZ;
    multiPoint.hasM = options.hasM;

    var pointCount = value.readUInt32();

    for (var i = 0; i < pointCount; i++)
        multiPoint.points.push(Geometry.parse(value, options));

    return multiPoint;
};

MultiPoint._parseTwkb = function (value, options) {
    var multiPoint = new MultiPoint();
    multiPoint.hasZ = options.hasZ;
    multiPoint.hasM = options.hasM;

    if (options.isEmpty)
        return multiPoint;

    var previousPoint = new Point(0, 0, options.hasZ ? 0 : undefined, options.hasM ? 0 : undefined);
    var pointCount = value.readVarInt();

    for (var i = 0; i < pointCount; i++)
        multiPoint.points.push(Point._readTwkbPoint(value, options, previousPoint));

    return multiPoint;
};

MultiPoint._parseGeoJSON = function (value) {
    var multiPoint = new MultiPoint();

    if (value.coordinates.length > 0)
        multiPoint.hasZ = value.coordinates[0].length > 2;

    for (var i = 0; i < value.coordinates.length; i++)
        multiPoint.points.push(Point._parseGeoJSON({ coordinates: value.coordinates[i] }));

    return multiPoint;
};

MultiPoint.prototype.toWkt = function () {
    if (this.points.length === 0)
        return this._getWktType(Types.wkt.MultiPoint, true);

    var wkt = this._getWktType(Types.wkt.MultiPoint, false) + '(';

    for (var i = 0; i < this.points.length; i++)
        wkt += this._getWktCoordinate(this.points[i]) + ',';

    wkt = wkt.slice(0, -1);
    wkt += ')';

    return wkt;
};

MultiPoint.prototype.toWkb = function () {
    var wkb = new BinaryWriter(this._getWkbSize());

    wkb.writeInt8(1);

    this._writeWkbType(wkb, Types.wkb.MultiPoint);
    wkb.writeUInt32LE(this.points.length);

    for (var i = 0; i < this.points.length; i++)
        wkb.writeBuffer(this.points[i].toWkb({ srid: this.srid }));

    return wkb.buffer;
};

MultiPoint.prototype.toTwkb = function () {
    var twkb = new BinaryWriter(0, true);

    var precision = Geometry.getTwkbPrecision(5, 0, 0);
    var isEmpty = this.points.length === 0;

    this._writeTwkbHeader(twkb, Types.wkb.MultiPoint, precision, isEmpty);

    if (this.points.length > 0) {
        twkb.writeVarInt(this.points.length);

        var previousPoint = new Point(0, 0, 0, 0);
        for (var i = 0; i < this.points.length; i++)
            this.points[i]._writeTwkbPoint(twkb, precision, previousPoint);
    }

    return twkb.buffer;
};

MultiPoint.prototype._getWkbSize = function () {
    var coordinateSize = 16;

    if (this.hasZ)
        coordinateSize += 8;
    if (this.hasM)
        coordinateSize += 8;

    coordinateSize += 5;

    return 1 + 4 + 4 + (this.points.length * coordinateSize);
};

MultiPoint.prototype.toGeoJSON = function (options) {
    var geoJSON = Geometry.prototype.toGeoJSON.call(this, options);
    geoJSON.type = Types.geoJSON.MultiPoint;
    geoJSON.coordinates = [];

    for (var i = 0; i < this.points.length; i++)
        geoJSON.coordinates.push(this.points[i].toGeoJSON().coordinates);

    return geoJSON;
};

function MultiPolygon(polygons, srid) {
    Geometry.call(this);

    this.polygons = polygons || [];
	this.srid = srid;

    if (this.polygons.length > 0) {
        this.hasZ = this.polygons[0].hasZ;
        this.hasM = this.polygons[0].hasM;
    }
}

inherits(MultiPolygon, Geometry);

MultiPolygon.Z = function (polygons, srid) {
    var multiPolygon = new MultiPolygon(polygons, srid);
    multiPolygon.hasZ = true;
    return multiPolygon;
};

MultiPolygon.M = function (polygons, srid) {
    var multiPolygon = new MultiPolygon(polygons, srid);
    multiPolygon.hasM = true;
    return multiPolygon;
};

MultiPolygon.ZM = function (polygons, srid) {
    var multiPolygon = new MultiPolygon(polygons, srid);
    multiPolygon.hasZ = true;
    multiPolygon.hasM = true;
    return multiPolygon;
};

MultiPolygon._parseWkt = function (value, options) {
    var multiPolygon = new MultiPolygon();
    multiPolygon.srid = options.srid;
    multiPolygon.hasZ = options.hasZ;
    multiPolygon.hasM = options.hasM;

    if (value.isMatch(['EMPTY']))
        return multiPolygon;

    value.expectGroupStart();

    do {
        value.expectGroupStart();

        var exteriorRing = [];
        var interiorRings = [];

        value.expectGroupStart();
        exteriorRing.push.apply(exteriorRing, value.matchCoordinates(options));
        value.expectGroupEnd();

        while (value.isMatch([','])) {
            value.expectGroupStart();
            interiorRings.push(value.matchCoordinates(options));
            value.expectGroupEnd();
        }

        multiPolygon.polygons.push(new Polygon(exteriorRing, interiorRings));

        value.expectGroupEnd();

    } while (value.isMatch([',']));

    value.expectGroupEnd();

    return multiPolygon;
};

MultiPolygon._parseWkb = function (value, options) {
    var multiPolygon = new MultiPolygon();
    multiPolygon.srid = options.srid;
    multiPolygon.hasZ = options.hasZ;
    multiPolygon.hasM = options.hasM;

    var polygonCount = value.readUInt32();

    for (var i = 0; i < polygonCount; i++)
        multiPolygon.polygons.push(Geometry.parse(value, options));

    return multiPolygon;
};

MultiPolygon._parseTwkb = function (value, options) {
    var multiPolygon = new MultiPolygon();
    multiPolygon.hasZ = options.hasZ;
    multiPolygon.hasM = options.hasM;

    if (options.isEmpty)
        return multiPolygon;

    var previousPoint = new Point(0, 0, options.hasZ ? 0 : undefined, options.hasM ? 0 : undefined);
    var polygonCount = value.readVarInt();

    for (var i = 0; i < polygonCount; i++) {
        var polygon = new Polygon();
        polygon.hasZ = options.hasZ;
        polygon.hasM = options.hasM;

        var ringCount = value.readVarInt();
        var exteriorRingCount = value.readVarInt();

        for (var j = 0; j < exteriorRingCount; j++)
            polygon.exteriorRing.push(Point._readTwkbPoint(value, options, previousPoint));

        for (j = 1; j < ringCount; j++) {
            var interiorRing = [];

            var interiorRingCount = value.readVarInt();

            for (var k = 0; k < interiorRingCount; k++)
                interiorRing.push(Point._readTwkbPoint(value, options, previousPoint));

            polygon.interiorRings.push(interiorRing);
        }

        multiPolygon.polygons.push(polygon);
    }

    return multiPolygon;
};

MultiPolygon._parseGeoJSON = function (value) {
    var multiPolygon = new MultiPolygon();

    if (value.coordinates.length > 0 && value.coordinates[0].length > 0 && value.coordinates[0][0].length > 0)
        multiPolygon.hasZ = value.coordinates[0][0][0].length > 2;

    for (var i = 0; i < value.coordinates.length; i++)
        multiPolygon.polygons.push(Polygon._parseGeoJSON({ coordinates: value.coordinates[i] }));

    return multiPolygon;
};

MultiPolygon.prototype.toWkt = function () {
    if (this.polygons.length === 0)
        return this._getWktType(Types.wkt.MultiPolygon, true);

    var wkt = this._getWktType(Types.wkt.MultiPolygon, false) + '(';

    for (var i = 0; i < this.polygons.length; i++)
        wkt += this.polygons[i]._toInnerWkt() + ',';

    wkt = wkt.slice(0, -1);
    wkt += ')';

    return wkt;
};

MultiPolygon.prototype.toWkb = function () {
    var wkb = new BinaryWriter(this._getWkbSize());

    wkb.writeInt8(1);

    this._writeWkbType(wkb, Types.wkb.MultiPolygon);
    wkb.writeUInt32LE(this.polygons.length);

    for (var i = 0; i < this.polygons.length; i++)
        wkb.writeBuffer(this.polygons[i].toWkb({ srid: this.srid }));

    return wkb.buffer;
};

MultiPolygon.prototype.toTwkb = function () {
    var twkb = new BinaryWriter(0, true);

    var precision = Geometry.getTwkbPrecision(5, 0, 0);
    var isEmpty = this.polygons.length === 0;

    this._writeTwkbHeader(twkb, Types.wkb.MultiPolygon, precision, isEmpty);

    if (this.polygons.length > 0) {
        twkb.writeVarInt(this.polygons.length);

        var previousPoint = new Point(0, 0, 0, 0);
        for (var i = 0; i < this.polygons.length; i++) {
            twkb.writeVarInt(1 + this.polygons[i].interiorRings.length);

            twkb.writeVarInt(this.polygons[i].exteriorRing.length);

            for (var j = 0; j < this.polygons[i].exteriorRing.length; j++)
                this.polygons[i].exteriorRing[j]._writeTwkbPoint(twkb, precision, previousPoint);

            for (j = 0; j < this.polygons[i].interiorRings.length; j++) {
                twkb.writeVarInt(this.polygons[i].interiorRings[j].length);

                for (var k = 0; k < this.polygons[i].interiorRings[j].length; k++)
                    this.polygons[i].interiorRings[j][k]._writeTwkbPoint(twkb, precision, previousPoint);
            }
        }
    }

    return twkb.buffer;
};

MultiPolygon.prototype._getWkbSize = function () {
    var size = 1 + 4 + 4;

    for (var i = 0; i < this.polygons.length; i++)
        size += this.polygons[i]._getWkbSize();

    return size;
};

MultiPolygon.prototype.toGeoJSON = function (options) {
    var geoJSON = Geometry.prototype.toGeoJSON.call(this, options);
    geoJSON.type = Types.geoJSON.MultiPolygon;
    geoJSON.coordinates = [];

    for (var i = 0; i < this.polygons.length; i++)
        geoJSON.coordinates.push(this.polygons[i].toGeoJSON().coordinates);

    return geoJSON;
};

function Point(x, y, z, m, srid) {
    Geometry.call(this);

    this.x = x;
    this.y = y;
    this.z = z;
    this.m = m;
	this.srid = srid;

    this.hasZ = typeof this.z !== 'undefined';
    this.hasM = typeof this.m !== 'undefined';
}

inherits(Point, Geometry);

Point.Z = function (x, y, z, srid) {
    var point = new Point(x, y, z, undefined, srid);
    point.hasZ = true;
    return point;
};

Point.M = function (x, y, m, srid) {
    var point = new Point(x, y, undefined, m, srid);
    point.hasM = true;
    return point;
};

Point.ZM = function (x, y, z, m, srid) {
    var point = new Point(x, y, z, m, srid);
    point.hasZ = true;
    point.hasM = true;
    return point;
};

Point._parseWkt = function (value, options) {
    var point = new Point();
    point.srid = options.srid;
    point.hasZ = options.hasZ;
    point.hasM = options.hasM;

    if (value.isMatch(['EMPTY']))
        return point;

    value.expectGroupStart();

    var coordinate = value.matchCoordinate(options);

    point.x = coordinate.x;
    point.y = coordinate.y;
    point.z = coordinate.z;
    point.m = coordinate.m;

    value.expectGroupEnd();

    return point;
};

Point._parseWkb = function (value, options) {
    var point = Point._readWkbPoint(value, options);
    point.srid = options.srid;
    return point;
};

Point._readWkbPoint = function (value, options) {
    return new Point(value.readDouble(), value.readDouble(),
        options.hasZ ? value.readDouble() : undefined,
        options.hasM ? value.readDouble() : undefined);
};

Point._parseTwkb = function (value, options) {
    var point = new Point();
    point.hasZ = options.hasZ;
    point.hasM = options.hasM;

    if (options.isEmpty)
        return point;

    point.x = ZigZag.decode(value.readVarInt()) / options.precisionFactor;
    point.y = ZigZag.decode(value.readVarInt()) / options.precisionFactor;
    point.z = options.hasZ ? ZigZag.decode(value.readVarInt()) / options.zPrecisionFactor : undefined;
    point.m = options.hasM ? ZigZag.decode(value.readVarInt()) / options.mPrecisionFactor : undefined;

    return point;
};

Point._readTwkbPoint = function (value, options, previousPoint) {
    previousPoint.x += ZigZag.decode(value.readVarInt()) / options.precisionFactor;
    previousPoint.y += ZigZag.decode(value.readVarInt()) / options.precisionFactor;

    if (options.hasZ)
        previousPoint.z += ZigZag.decode(value.readVarInt()) / options.zPrecisionFactor;
    if (options.hasM)
        previousPoint.m += ZigZag.decode(value.readVarInt()) / options.mPrecisionFactor;

    return new Point(previousPoint.x, previousPoint.y, previousPoint.z, previousPoint.m);
};

Point._parseGeoJSON = function (value) {
    return Point._readGeoJSONPoint(value.coordinates);
};

Point._readGeoJSONPoint = function (coordinates) {
    if (coordinates.length === 0)
        return new Point();

    if (coordinates.length > 2)
        return new Point(coordinates[0], coordinates[1], coordinates[2]);

    return new Point(coordinates[0], coordinates[1]);
};

Point.prototype.toWkt = function () {
    if (typeof this.x === 'undefined' && typeof this.y === 'undefined' &&
        typeof this.z === 'undefined' && typeof this.m === 'undefined')
        return this._getWktType(Types.wkt.Point, true);

    return this._getWktType(Types.wkt.Point, false) + '(' + this._getWktCoordinate(this) + ')';
};

Point.prototype.toWkb = function (parentOptions) {
    var wkb = new BinaryWriter(this._getWkbSize());

    wkb.writeInt8(1);
    this._writeWkbType(wkb, Types.wkb.Point, parentOptions);

    if (typeof this.x === 'undefined' && typeof this.y === 'undefined') {
        wkb.writeDoubleLE(NaN);
        wkb.writeDoubleLE(NaN);

        if (this.hasZ)
            wkb.writeDoubleLE(NaN);
        if (this.hasM)
            wkb.writeDoubleLE(NaN);
    }
    else {
        this._writeWkbPoint(wkb);
    }

    return wkb.buffer;
};

Point.prototype._writeWkbPoint = function (wkb) {
    wkb.writeDoubleLE(this.x);
    wkb.writeDoubleLE(this.y);

    if (this.hasZ)
        wkb.writeDoubleLE(this.z);
    if (this.hasM)
        wkb.writeDoubleLE(this.m);
};

Point.prototype.toTwkb = function () {
    var twkb = new BinaryWriter(0, true);

    var precision = Geometry.getTwkbPrecision(5, 0, 0);
    var isEmpty = typeof this.x === 'undefined' && typeof this.y === 'undefined';

    this._writeTwkbHeader(twkb, Types.wkb.Point, precision, isEmpty);

    if (!isEmpty)
        this._writeTwkbPoint(twkb, precision, new Point(0, 0, 0, 0));

    return twkb.buffer;
};

Point.prototype._writeTwkbPoint = function (twkb, precision, previousPoint) {
    var x = this.x * precision.xyFactor;
    var y = this.y * precision.xyFactor;
    var z = this.z * precision.zFactor;
    var m = this.m * precision.mFactor;

    twkb.writeVarInt(ZigZag.encode(x - previousPoint.x));
    twkb.writeVarInt(ZigZag.encode(y - previousPoint.y));
    if (this.hasZ)
        twkb.writeVarInt(ZigZag.encode(z - previousPoint.z));
    if (this.hasM)
        twkb.writeVarInt(ZigZag.encode(m - previousPoint.m));

    previousPoint.x = x;
    previousPoint.y = y;
    previousPoint.z = z;
    previousPoint.m = m;
};

Point.prototype._getWkbSize = function () {
    var size = 1 + 4 + 8 + 8;

    if (this.hasZ)
        size += 8;
    if (this.hasM)
        size += 8;

    return size;
};

Point.prototype.toGeoJSON = function (options) {
    var geoJSON = Geometry.prototype.toGeoJSON.call(this, options);
    geoJSON.type = Types.geoJSON.Point;

    if (typeof this.x === 'undefined' && typeof this.y === 'undefined')
        geoJSON.coordinates = [];
    else if (typeof this.z !== 'undefined')
        geoJSON.coordinates = [this.x, this.y, this.z];
    else
        geoJSON.coordinates = [this.x, this.y];

    return geoJSON;
};

function Polygon(exteriorRing, interiorRings, srid) {
    Geometry.call(this);

    this.exteriorRing = exteriorRing || [];
    this.interiorRings = interiorRings || [];
	this.srid = srid;

    if (this.exteriorRing.length > 0) {
        this.hasZ = this.exteriorRing[0].hasZ;
        this.hasM = this.exteriorRing[0].hasM;
    }
}

inherits(Polygon, Geometry);

Polygon.Z = function (exteriorRing, interiorRings, srid) {
    var polygon = new Polygon(exteriorRing, interiorRings, srid);
    polygon.hasZ = true;
    return polygon;
};

Polygon.M = function (exteriorRing, interiorRings, srid) {
    var polygon = new Polygon(exteriorRing, interiorRings, srid);
    polygon.hasM = true;
    return polygon;
};

Polygon.ZM = function (exteriorRing, interiorRings, srid) {
    var polygon = new Polygon(exteriorRing, interiorRings, srid);
    polygon.hasZ = true;
    polygon.hasM = true;
    return polygon;
};

Polygon._parseWkt = function (value, options) {
    var polygon = new Polygon();
    polygon.srid = options.srid;
    polygon.hasZ = options.hasZ;
    polygon.hasM = options.hasM;

    if (value.isMatch(['EMPTY']))
        return polygon;

    value.expectGroupStart();

    value.expectGroupStart();
    polygon.exteriorRing.push.apply(polygon.exteriorRing, value.matchCoordinates(options));
    value.expectGroupEnd();

    while (value.isMatch([','])) {
        value.expectGroupStart();
        polygon.interiorRings.push(value.matchCoordinates(options));
        value.expectGroupEnd();
    }

    value.expectGroupEnd();

    return polygon;
};

Polygon._parseWkb = function (value, options) {
    var polygon = new Polygon();
    polygon.srid = options.srid;
    polygon.hasZ = options.hasZ;
    polygon.hasM = options.hasM;

    var ringCount = value.readUInt32();

    if (ringCount > 0) {
        var exteriorRingCount = value.readUInt32();

        for (var i = 0; i < exteriorRingCount; i++)
            polygon.exteriorRing.push(Point._readWkbPoint(value, options));

        for (i = 1; i < ringCount; i++) {
            var interiorRing = [];

            var interiorRingCount = value.readUInt32();

            for (var j = 0; j < interiorRingCount; j++)
                interiorRing.push(Point._readWkbPoint(value, options));

            polygon.interiorRings.push(interiorRing);
        }
    }

    return polygon;
};

Polygon._parseTwkb = function (value, options) {
    var polygon = new Polygon();
    polygon.hasZ = options.hasZ;
    polygon.hasM = options.hasM;

    if (options.isEmpty)
        return polygon;

    var previousPoint = new Point(0, 0, options.hasZ ? 0 : undefined, options.hasM ? 0 : undefined);
    var ringCount = value.readVarInt();
    var exteriorRingCount = value.readVarInt();

    for (var i = 0; i < exteriorRingCount; i++)
        polygon.exteriorRing.push(Point._readTwkbPoint(value, options, previousPoint));

    for (i = 1; i < ringCount; i++) {
        var interiorRing = [];

        var interiorRingCount = value.readVarInt();

        for (var j = 0; j < interiorRingCount; j++)
            interiorRing.push(Point._readTwkbPoint(value, options, previousPoint));

        polygon.interiorRings.push(interiorRing);
    }

    return polygon;
};

Polygon._parseGeoJSON = function (value) {
    var polygon = new Polygon();

    if (value.coordinates.length > 0 && value.coordinates[0].length > 0)
        polygon.hasZ = value.coordinates[0][0].length > 2;

    for (var i = 0; i < value.coordinates.length; i++) {
        if (i > 0)
            polygon.interiorRings.push([]);

        for (var j = 0; j  < value.coordinates[i].length; j++) {
            if (i === 0)
                polygon.exteriorRing.push(Point._readGeoJSONPoint(value.coordinates[i][j]));
            else
                polygon.interiorRings[i - 1].push(Point._readGeoJSONPoint(value.coordinates[i][j]));
        }
    }

    return polygon;
};

Polygon.prototype.toWkt = function () {
    if (this.exteriorRing.length === 0)
        return this._getWktType(Types.wkt.Polygon, true);

    return this._getWktType(Types.wkt.Polygon, false) + this._toInnerWkt();
};

Polygon.prototype._toInnerWkt = function () {
    var innerWkt = '((';

    for (var i = 0; i < this.exteriorRing.length; i++)
        innerWkt += this._getWktCoordinate(this.exteriorRing[i]) + ',';

    innerWkt = innerWkt.slice(0, -1);
    innerWkt += ')';

    for (i = 0; i < this.interiorRings.length; i++) {
        innerWkt += ',(';

        for (var j = 0; j < this.interiorRings[i].length; j++) {
            innerWkt += this._getWktCoordinate(this.interiorRings[i][j]) + ',';
        }

        innerWkt = innerWkt.slice(0, -1);
        innerWkt += ')';
    }

    innerWkt += ')';

    return innerWkt;
};

Polygon.prototype.toWkb = function (parentOptions) {
    var wkb = new BinaryWriter(this._getWkbSize());

    wkb.writeInt8(1);

    this._writeWkbType(wkb, Types.wkb.Polygon, parentOptions);

    if (this.exteriorRing.length > 0) {
        wkb.writeUInt32LE(1 + this.interiorRings.length);
        wkb.writeUInt32LE(this.exteriorRing.length);
    }
    else {
        wkb.writeUInt32LE(0);
    }

    for (var i = 0; i < this.exteriorRing.length; i++)
        this.exteriorRing[i]._writeWkbPoint(wkb);

    for (i = 0; i < this.interiorRings.length; i++) {
        wkb.writeUInt32LE(this.interiorRings[i].length);

        for (var j = 0; j < this.interiorRings[i].length; j++)
            this.interiorRings[i][j]._writeWkbPoint(wkb);
    }

    return wkb.buffer;
};

Polygon.prototype.toTwkb = function () {
    var twkb = new BinaryWriter(0, true);

    var precision = Geometry.getTwkbPrecision(5, 0, 0);
    var isEmpty = this.exteriorRing.length === 0;

    this._writeTwkbHeader(twkb, Types.wkb.Polygon, precision, isEmpty);

    if (this.exteriorRing.length > 0) {
        twkb.writeVarInt(1 + this.interiorRings.length);

        twkb.writeVarInt(this.exteriorRing.length);

        var previousPoint = new Point(0, 0, 0, 0);
        for (var i = 0; i < this.exteriorRing.length; i++)
            this.exteriorRing[i]._writeTwkbPoint(twkb, precision, previousPoint);

        for (i = 0; i < this.interiorRings.length; i++) {
            twkb.writeVarInt(this.interiorRings[i].length);

            for (var j = 0; j < this.interiorRings[i].length; j++)
                this.interiorRings[i][j]._writeTwkbPoint(twkb, precision, previousPoint);
        }
    }

    return twkb.buffer;
};

Polygon.prototype._getWkbSize = function () {
    var coordinateSize = 16;

    if (this.hasZ)
        coordinateSize += 8;
    if (this.hasM)
        coordinateSize += 8;

    var size = 1 + 4 + 4;

    if (this.exteriorRing.length > 0)
        size += 4 + (this.exteriorRing.length * coordinateSize);

    for (var i = 0; i < this.interiorRings.length; i++)
        size += 4 + (this.interiorRings[i].length * coordinateSize);

    return size;
};

Polygon.prototype.toGeoJSON = function (options) {
    var geoJSON = Geometry.prototype.toGeoJSON.call(this, options);
    geoJSON.type = Types.geoJSON.Polygon;
    geoJSON.coordinates = [];

    if (this.exteriorRing.length > 0) {
        var exteriorRing = [];

        for (var i = 0; i < this.exteriorRing.length; i++) {
            if (this.hasZ)
                exteriorRing.push([this.exteriorRing[i].x, this.exteriorRing[i].y, this.exteriorRing[i].z]);
            else
                exteriorRing.push([this.exteriorRing[i].x, this.exteriorRing[i].y]);
        }

        geoJSON.coordinates.push(exteriorRing);
    }

    for (var j = 0; j < this.interiorRings.length; j++) {
        var interiorRing = [];

        for (var k = 0; k < this.interiorRings[j].length; k++) {
            if (this.hasZ)
                interiorRing.push([this.interiorRings[j][k].x, this.interiorRings[j][k].y, this.interiorRings[j][k].z]);
            else
                interiorRing.push([this.interiorRings[j][k].x, this.interiorRings[j][k].y]);
        }

        geoJSON.coordinates.push(interiorRing);
    }

    return geoJSON;
};

function inherits(ctor, superCtor) {
    // implementation from standard node.js 'util' module
    ctor.super_ = superCtor;
    ctor.prototype = Object.create(superCtor.prototype, {
        constructor: {
            value: ctor,
            enumerable: false,
            writable: true,
            configurable: true
        }
    });
}

function WktParser(value) {
    this.value = value;
    this.position = 0;
}

WktParser.prototype.match = function (tokens) {
    this.skipWhitespaces();

    for (var i = 0; i < tokens.length; i++) {
        if (this.value.substring(this.position).indexOf(tokens[i]) === 0) {
            this.position += tokens[i].length;
            return tokens[i];
        }
    }

    return null;
};

WktParser.prototype.matchRegex = function (tokens) {
    this.skipWhitespaces();

    for (var i = 0; i < tokens.length; i++) {
        var match = this.value.substring(this.position).match(tokens[i]);

        if (match) {
            this.position += match[0].length;
            return match;
        }
    }

    return null;
};

WktParser.prototype.isMatch = function (tokens) {
    this.skipWhitespaces();

    for (var i = 0; i < tokens.length; i++) {
        if (this.value.substring(this.position).indexOf(tokens[i]) === 0) {
            this.position += tokens[i].length;
            return true;
        }
    }

    return false;
};

WktParser.prototype.matchType = function () {
    var geometryType = this.match([Types.wkt.Point, Types.wkt.LineString, Types.wkt.Polygon, Types.wkt.MultiPoint,
    Types.wkt.MultiLineString, Types.wkt.MultiPolygon, Types.wkt.GeometryCollection]);

    if (!geometryType)
        throw new Error('Expected geometry type');

    return geometryType;
};

WktParser.prototype.matchDimension = function () {
    var dimension = this.match(['ZM', 'Z', 'M']);

    switch (dimension) {
        case 'ZM': return { hasZ: true, hasM: true };
        case 'Z': return { hasZ: true, hasM: false };
        case 'M': return { hasZ: false, hasM: true };
        default: return { hasZ: false, hasM: false };
    }
};

WktParser.prototype.expectGroupStart = function () {
    if (!this.isMatch(['(']))
        throw new Error('Expected group start');
};

WktParser.prototype.expectGroupEnd = function () {
    if (!this.isMatch([')']))
        throw new Error('Expected group end');
};

WktParser.prototype.matchCoordinate = function (options) {
    var match;

    if (options.hasZ && options.hasM)
        match = this.matchRegex([/^(\S*)\s+(\S*)\s+(\S*)\s+([^\s,)]*)/]);
    else if (options.hasZ || options.hasM)
        match = this.matchRegex([/^(\S*)\s+(\S*)\s+([^\s,)]*)/]);
    else
        match = this.matchRegex([/^(\S*)\s+([^\s,)]*)/]);

    if (!match)
        throw new Error('Expected coordinates');

    if (options.hasZ && options.hasM)
        return new Point(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]), parseFloat(match[4]));
    else if (options.hasZ)
        return new Point(parseFloat(match[1]), parseFloat(match[2]), parseFloat(match[3]));
    else if (options.hasM)
        return new Point(parseFloat(match[1]), parseFloat(match[2]), undefined, parseFloat(match[3]));
    else
        return new Point(parseFloat(match[1]), parseFloat(match[2]));
};

WktParser.prototype.matchCoordinates = function (options) {
    var coordinates = [];

    do {
        var startsWithBracket = this.isMatch(['(']);

        coordinates.push(this.matchCoordinate(options));

        if (startsWithBracket)
            this.expectGroupEnd();
    } while (this.isMatch([',']));

    return coordinates;
};

WktParser.prototype.skipWhitespaces = function () {
    while (this.position < this.value.length && this.value[this.position] === ' ')
        this.position++;
};

export {
    Geometry,
    GeometryCollection,
    LineString,
    MultiLineString,
    MultiPoint,
    MultiPolygon,
    Point,
    Polygon
}