/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const database_blob = $root.database_blob = (() => {

    /**
     * Namespace database_blob.
     * @exports database_blob
     * @namespace
     */
    const database_blob = {};

    database_blob.DatabaseBlobRowRid = (function() {

        /**
         * Properties of a DatabaseBlobRowRid.
         * @memberof database_blob
         * @interface IDatabaseBlobRowRid
         * @property {number|Long|null} [timestamp] DatabaseBlobRowRid timestamp
         * @property {number|null} [seqNo] DatabaseBlobRowRid seqNo
         */

        /**
         * Constructs a new DatabaseBlobRowRid.
         * @memberof database_blob
         * @classdesc Represents a DatabaseBlobRowRid.
         * @implements IDatabaseBlobRowRid
         * @constructor
         * @param {database_blob.IDatabaseBlobRowRid=} [properties] Properties to set
         */
        function DatabaseBlobRowRid(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * DatabaseBlobRowRid timestamp.
         * @member {number|Long} timestamp
         * @memberof database_blob.DatabaseBlobRowRid
         * @instance
         */
        DatabaseBlobRowRid.prototype.timestamp = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * DatabaseBlobRowRid seqNo.
         * @member {number} seqNo
         * @memberof database_blob.DatabaseBlobRowRid
         * @instance
         */
        DatabaseBlobRowRid.prototype.seqNo = 0;

        /**
         * Creates a new DatabaseBlobRowRid instance using the specified properties.
         * @function create
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {database_blob.IDatabaseBlobRowRid=} [properties] Properties to set
         * @returns {database_blob.DatabaseBlobRowRid} DatabaseBlobRowRid instance
         */
        DatabaseBlobRowRid.create = function create(properties) {
            return new DatabaseBlobRowRid(properties);
        };

        /**
         * Encodes the specified DatabaseBlobRowRid message. Does not implicitly {@link database_blob.DatabaseBlobRowRid.verify|verify} messages.
         * @function encode
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {database_blob.IDatabaseBlobRowRid} message DatabaseBlobRowRid message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowRid.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.timestamp != null && Object.hasOwnProperty.call(message, "timestamp"))
                writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.timestamp);
            if (message.seqNo != null && Object.hasOwnProperty.call(message, "seqNo"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.seqNo);
            return writer;
        };

        /**
         * Encodes the specified DatabaseBlobRowRid message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowRid.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {database_blob.IDatabaseBlobRowRid} message DatabaseBlobRowRid message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowRid.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a DatabaseBlobRowRid message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.DatabaseBlobRowRid} DatabaseBlobRowRid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowRid.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.DatabaseBlobRowRid();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.timestamp = reader.uint64();
                        break;
                    }
                case 2: {
                        message.seqNo = reader.uint32();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a DatabaseBlobRowRid message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.DatabaseBlobRowRid} DatabaseBlobRowRid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowRid.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a DatabaseBlobRowRid message.
         * @function verify
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        DatabaseBlobRowRid.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.timestamp != null && message.hasOwnProperty("timestamp"))
                if (!$util.isInteger(message.timestamp) && !(message.timestamp && $util.isInteger(message.timestamp.low) && $util.isInteger(message.timestamp.high)))
                    return "timestamp: integer|Long expected";
            if (message.seqNo != null && message.hasOwnProperty("seqNo"))
                if (!$util.isInteger(message.seqNo))
                    return "seqNo: integer expected";
            return null;
        };

        /**
         * Creates a DatabaseBlobRowRid message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.DatabaseBlobRowRid} DatabaseBlobRowRid
         */
        DatabaseBlobRowRid.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.DatabaseBlobRowRid)
                return object;
            let message = new $root.database_blob.DatabaseBlobRowRid();
            if (object.timestamp != null)
                if ($util.Long)
                    (message.timestamp = $util.Long.fromValue(object.timestamp)).unsigned = true;
                else if (typeof object.timestamp === "string")
                    message.timestamp = parseInt(object.timestamp, 10);
                else if (typeof object.timestamp === "number")
                    message.timestamp = object.timestamp;
                else if (typeof object.timestamp === "object")
                    message.timestamp = new $util.LongBits(object.timestamp.low >>> 0, object.timestamp.high >>> 0).toNumber(true);
            if (object.seqNo != null)
                message.seqNo = object.seqNo >>> 0;
            return message;
        };

        /**
         * Creates a plain object from a DatabaseBlobRowRid message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {database_blob.DatabaseBlobRowRid} message DatabaseBlobRowRid
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        DatabaseBlobRowRid.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.timestamp = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.timestamp = options.longs === String ? "0" : 0;
                object.seqNo = 0;
            }
            if (message.timestamp != null && message.hasOwnProperty("timestamp"))
                if (typeof message.timestamp === "number")
                    object.timestamp = options.longs === String ? String(message.timestamp) : message.timestamp;
                else
                    object.timestamp = options.longs === String ? $util.Long.prototype.toString.call(message.timestamp) : options.longs === Number ? new $util.LongBits(message.timestamp.low >>> 0, message.timestamp.high >>> 0).toNumber(true) : message.timestamp;
            if (message.seqNo != null && message.hasOwnProperty("seqNo"))
                object.seqNo = message.seqNo;
            return object;
        };

        /**
         * Converts this DatabaseBlobRowRid to JSON.
         * @function toJSON
         * @memberof database_blob.DatabaseBlobRowRid
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        DatabaseBlobRowRid.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for DatabaseBlobRowRid
         * @function getTypeUrl
         * @memberof database_blob.DatabaseBlobRowRid
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        DatabaseBlobRowRid.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.DatabaseBlobRowRid";
        };

        return DatabaseBlobRowRid;
    })();

    database_blob.DatabaseBlobDiffRequest = (function() {

        /**
         * Properties of a DatabaseBlobDiffRequest.
         * @memberof database_blob
         * @interface IDatabaseBlobDiffRequest
         * @property {database_blob.IDatabaseBlobRowRid|null} [maxKnownRid] DatabaseBlobDiffRequest maxKnownRid
         * @property {number|null} [version] DatabaseBlobDiffRequest version
         */

        /**
         * Constructs a new DatabaseBlobDiffRequest.
         * @memberof database_blob
         * @classdesc Represents a DatabaseBlobDiffRequest.
         * @implements IDatabaseBlobDiffRequest
         * @constructor
         * @param {database_blob.IDatabaseBlobDiffRequest=} [properties] Properties to set
         */
        function DatabaseBlobDiffRequest(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * DatabaseBlobDiffRequest maxKnownRid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} maxKnownRid
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @instance
         */
        DatabaseBlobDiffRequest.prototype.maxKnownRid = null;

        /**
         * DatabaseBlobDiffRequest version.
         * @member {number} version
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @instance
         */
        DatabaseBlobDiffRequest.prototype.version = 0;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * DatabaseBlobDiffRequest _maxKnownRid.
         * @member {"maxKnownRid"|undefined} _maxKnownRid
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @instance
         */
        Object.defineProperty(DatabaseBlobDiffRequest.prototype, "_maxKnownRid", {
            get: $util.oneOfGetter($oneOfFields = ["maxKnownRid"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new DatabaseBlobDiffRequest instance using the specified properties.
         * @function create
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {database_blob.IDatabaseBlobDiffRequest=} [properties] Properties to set
         * @returns {database_blob.DatabaseBlobDiffRequest} DatabaseBlobDiffRequest instance
         */
        DatabaseBlobDiffRequest.create = function create(properties) {
            return new DatabaseBlobDiffRequest(properties);
        };

        /**
         * Encodes the specified DatabaseBlobDiffRequest message. Does not implicitly {@link database_blob.DatabaseBlobDiffRequest.verify|verify} messages.
         * @function encode
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {database_blob.IDatabaseBlobDiffRequest} message DatabaseBlobDiffRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobDiffRequest.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.maxKnownRid != null && Object.hasOwnProperty.call(message, "maxKnownRid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.maxKnownRid, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            if (message.version != null && Object.hasOwnProperty.call(message, "version"))
                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.version);
            return writer;
        };

        /**
         * Encodes the specified DatabaseBlobDiffRequest message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobDiffRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {database_blob.IDatabaseBlobDiffRequest} message DatabaseBlobDiffRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobDiffRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a DatabaseBlobDiffRequest message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.DatabaseBlobDiffRequest} DatabaseBlobDiffRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobDiffRequest.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.DatabaseBlobDiffRequest();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.maxKnownRid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                case 2: {
                        message.version = reader.int32();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a DatabaseBlobDiffRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.DatabaseBlobDiffRequest} DatabaseBlobDiffRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobDiffRequest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a DatabaseBlobDiffRequest message.
         * @function verify
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        DatabaseBlobDiffRequest.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.maxKnownRid != null && message.hasOwnProperty("maxKnownRid")) {
                properties._maxKnownRid = 1;
                {
                    let error = $root.database_blob.DatabaseBlobRowRid.verify(message.maxKnownRid);
                    if (error)
                        return "maxKnownRid." + error;
                }
            }
            if (message.version != null && message.hasOwnProperty("version"))
                if (!$util.isInteger(message.version))
                    return "version: integer expected";
            return null;
        };

        /**
         * Creates a DatabaseBlobDiffRequest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.DatabaseBlobDiffRequest} DatabaseBlobDiffRequest
         */
        DatabaseBlobDiffRequest.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.DatabaseBlobDiffRequest)
                return object;
            let message = new $root.database_blob.DatabaseBlobDiffRequest();
            if (object.maxKnownRid != null) {
                if (typeof object.maxKnownRid !== "object")
                    throw TypeError(".database_blob.DatabaseBlobDiffRequest.maxKnownRid: object expected");
                message.maxKnownRid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.maxKnownRid);
            }
            if (object.version != null)
                message.version = object.version | 0;
            return message;
        };

        /**
         * Creates a plain object from a DatabaseBlobDiffRequest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {database_blob.DatabaseBlobDiffRequest} message DatabaseBlobDiffRequest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        DatabaseBlobDiffRequest.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                object.version = 0;
            if (message.maxKnownRid != null && message.hasOwnProperty("maxKnownRid")) {
                object.maxKnownRid = $root.database_blob.DatabaseBlobRowRid.toObject(message.maxKnownRid, options);
                if (options.oneofs)
                    object._maxKnownRid = "maxKnownRid";
            }
            if (message.version != null && message.hasOwnProperty("version"))
                object.version = message.version;
            return object;
        };

        /**
         * Converts this DatabaseBlobDiffRequest to JSON.
         * @function toJSON
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        DatabaseBlobDiffRequest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for DatabaseBlobDiffRequest
         * @function getTypeUrl
         * @memberof database_blob.DatabaseBlobDiffRequest
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        DatabaseBlobDiffRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.DatabaseBlobDiffRequest";
        };

        return DatabaseBlobDiffRequest;
    })();

    database_blob.CollabDocState = (function() {

        /**
         * Properties of a CollabDocState.
         * @memberof database_blob
         * @interface ICollabDocState
         * @property {Uint8Array|null} [docState] CollabDocState docState
         * @property {number|null} [encoderVersion] CollabDocState encoderVersion
         */

        /**
         * Constructs a new CollabDocState.
         * @memberof database_blob
         * @classdesc Represents a CollabDocState.
         * @implements ICollabDocState
         * @constructor
         * @param {database_blob.ICollabDocState=} [properties] Properties to set
         */
        function CollabDocState(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * CollabDocState docState.
         * @member {Uint8Array} docState
         * @memberof database_blob.CollabDocState
         * @instance
         */
        CollabDocState.prototype.docState = $util.newBuffer([]);

        /**
         * CollabDocState encoderVersion.
         * @member {number} encoderVersion
         * @memberof database_blob.CollabDocState
         * @instance
         */
        CollabDocState.prototype.encoderVersion = 0;

        /**
         * Creates a new CollabDocState instance using the specified properties.
         * @function create
         * @memberof database_blob.CollabDocState
         * @static
         * @param {database_blob.ICollabDocState=} [properties] Properties to set
         * @returns {database_blob.CollabDocState} CollabDocState instance
         */
        CollabDocState.create = function create(properties) {
            return new CollabDocState(properties);
        };

        /**
         * Encodes the specified CollabDocState message. Does not implicitly {@link database_blob.CollabDocState.verify|verify} messages.
         * @function encode
         * @memberof database_blob.CollabDocState
         * @static
         * @param {database_blob.ICollabDocState} message CollabDocState message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CollabDocState.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.docState != null && Object.hasOwnProperty.call(message, "docState"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.docState);
            if (message.encoderVersion != null && Object.hasOwnProperty.call(message, "encoderVersion"))
                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.encoderVersion);
            return writer;
        };

        /**
         * Encodes the specified CollabDocState message, length delimited. Does not implicitly {@link database_blob.CollabDocState.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.CollabDocState
         * @static
         * @param {database_blob.ICollabDocState} message CollabDocState message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CollabDocState.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a CollabDocState message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.CollabDocState
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.CollabDocState} CollabDocState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CollabDocState.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.CollabDocState();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.docState = reader.bytes();
                        break;
                    }
                case 2: {
                        message.encoderVersion = reader.int32();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a CollabDocState message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.CollabDocState
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.CollabDocState} CollabDocState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CollabDocState.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a CollabDocState message.
         * @function verify
         * @memberof database_blob.CollabDocState
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        CollabDocState.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.docState != null && message.hasOwnProperty("docState"))
                if (!(message.docState && typeof message.docState.length === "number" || $util.isString(message.docState)))
                    return "docState: buffer expected";
            if (message.encoderVersion != null && message.hasOwnProperty("encoderVersion"))
                if (!$util.isInteger(message.encoderVersion))
                    return "encoderVersion: integer expected";
            return null;
        };

        /**
         * Creates a CollabDocState message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.CollabDocState
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.CollabDocState} CollabDocState
         */
        CollabDocState.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.CollabDocState)
                return object;
            let message = new $root.database_blob.CollabDocState();
            if (object.docState != null)
                if (typeof object.docState === "string")
                    $util.base64.decode(object.docState, message.docState = $util.newBuffer($util.base64.length(object.docState)), 0);
                else if (object.docState.length >= 0)
                    message.docState = object.docState;
            if (object.encoderVersion != null)
                message.encoderVersion = object.encoderVersion | 0;
            return message;
        };

        /**
         * Creates a plain object from a CollabDocState message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.CollabDocState
         * @static
         * @param {database_blob.CollabDocState} message CollabDocState
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        CollabDocState.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if (options.bytes === String)
                    object.docState = "";
                else {
                    object.docState = [];
                    if (options.bytes !== Array)
                        object.docState = $util.newBuffer(object.docState);
                }
                object.encoderVersion = 0;
            }
            if (message.docState != null && message.hasOwnProperty("docState"))
                object.docState = options.bytes === String ? $util.base64.encode(message.docState, 0, message.docState.length) : options.bytes === Array ? Array.prototype.slice.call(message.docState) : message.docState;
            if (message.encoderVersion != null && message.hasOwnProperty("encoderVersion"))
                object.encoderVersion = message.encoderVersion;
            return object;
        };

        /**
         * Converts this CollabDocState to JSON.
         * @function toJSON
         * @memberof database_blob.CollabDocState
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        CollabDocState.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for CollabDocState
         * @function getTypeUrl
         * @memberof database_blob.CollabDocState
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        CollabDocState.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.CollabDocState";
        };

        return CollabDocState;
    })();

    database_blob.DatabaseBlobRowDocument = (function() {

        /**
         * Properties of a DatabaseBlobRowDocument.
         * @memberof database_blob
         * @interface IDatabaseBlobRowDocument
         * @property {Uint8Array|null} [documentId] DatabaseBlobRowDocument documentId
         * @property {database_blob.IDatabaseBlobRowRid|null} [rid] DatabaseBlobRowDocument rid
         * @property {boolean|null} [deleted] DatabaseBlobRowDocument deleted
         * @property {database_blob.ICollabDocState|null} [docState] DatabaseBlobRowDocument docState
         */

        /**
         * Constructs a new DatabaseBlobRowDocument.
         * @memberof database_blob
         * @classdesc Represents a DatabaseBlobRowDocument.
         * @implements IDatabaseBlobRowDocument
         * @constructor
         * @param {database_blob.IDatabaseBlobRowDocument=} [properties] Properties to set
         */
        function DatabaseBlobRowDocument(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * DatabaseBlobRowDocument documentId.
         * @member {Uint8Array} documentId
         * @memberof database_blob.DatabaseBlobRowDocument
         * @instance
         */
        DatabaseBlobRowDocument.prototype.documentId = $util.newBuffer([]);

        /**
         * DatabaseBlobRowDocument rid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} rid
         * @memberof database_blob.DatabaseBlobRowDocument
         * @instance
         */
        DatabaseBlobRowDocument.prototype.rid = null;

        /**
         * DatabaseBlobRowDocument deleted.
         * @member {boolean} deleted
         * @memberof database_blob.DatabaseBlobRowDocument
         * @instance
         */
        DatabaseBlobRowDocument.prototype.deleted = false;

        /**
         * DatabaseBlobRowDocument docState.
         * @member {database_blob.ICollabDocState|null|undefined} docState
         * @memberof database_blob.DatabaseBlobRowDocument
         * @instance
         */
        DatabaseBlobRowDocument.prototype.docState = null;

        /**
         * Creates a new DatabaseBlobRowDocument instance using the specified properties.
         * @function create
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {database_blob.IDatabaseBlobRowDocument=} [properties] Properties to set
         * @returns {database_blob.DatabaseBlobRowDocument} DatabaseBlobRowDocument instance
         */
        DatabaseBlobRowDocument.create = function create(properties) {
            return new DatabaseBlobRowDocument(properties);
        };

        /**
         * Encodes the specified DatabaseBlobRowDocument message. Does not implicitly {@link database_blob.DatabaseBlobRowDocument.verify|verify} messages.
         * @function encode
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {database_blob.IDatabaseBlobRowDocument} message DatabaseBlobRowDocument message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowDocument.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.documentId != null && Object.hasOwnProperty.call(message, "documentId"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.documentId);
            if (message.rid != null && Object.hasOwnProperty.call(message, "rid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.rid, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.deleted != null && Object.hasOwnProperty.call(message, "deleted"))
                writer.uint32(/* id 3, wireType 0 =*/24).bool(message.deleted);
            if (message.docState != null && Object.hasOwnProperty.call(message, "docState"))
                $root.database_blob.CollabDocState.encode(message.docState, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified DatabaseBlobRowDocument message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowDocument.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {database_blob.IDatabaseBlobRowDocument} message DatabaseBlobRowDocument message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowDocument.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a DatabaseBlobRowDocument message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.DatabaseBlobRowDocument} DatabaseBlobRowDocument
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowDocument.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.DatabaseBlobRowDocument();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.documentId = reader.bytes();
                        break;
                    }
                case 2: {
                        message.rid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.deleted = reader.bool();
                        break;
                    }
                case 4: {
                        message.docState = $root.database_blob.CollabDocState.decode(reader, reader.uint32());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a DatabaseBlobRowDocument message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.DatabaseBlobRowDocument} DatabaseBlobRowDocument
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowDocument.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a DatabaseBlobRowDocument message.
         * @function verify
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        DatabaseBlobRowDocument.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.documentId != null && message.hasOwnProperty("documentId"))
                if (!(message.documentId && typeof message.documentId.length === "number" || $util.isString(message.documentId)))
                    return "documentId: buffer expected";
            if (message.rid != null && message.hasOwnProperty("rid")) {
                let error = $root.database_blob.DatabaseBlobRowRid.verify(message.rid);
                if (error)
                    return "rid." + error;
            }
            if (message.deleted != null && message.hasOwnProperty("deleted"))
                if (typeof message.deleted !== "boolean")
                    return "deleted: boolean expected";
            if (message.docState != null && message.hasOwnProperty("docState")) {
                let error = $root.database_blob.CollabDocState.verify(message.docState);
                if (error)
                    return "docState." + error;
            }
            return null;
        };

        /**
         * Creates a DatabaseBlobRowDocument message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.DatabaseBlobRowDocument} DatabaseBlobRowDocument
         */
        DatabaseBlobRowDocument.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.DatabaseBlobRowDocument)
                return object;
            let message = new $root.database_blob.DatabaseBlobRowDocument();
            if (object.documentId != null)
                if (typeof object.documentId === "string")
                    $util.base64.decode(object.documentId, message.documentId = $util.newBuffer($util.base64.length(object.documentId)), 0);
                else if (object.documentId.length >= 0)
                    message.documentId = object.documentId;
            if (object.rid != null) {
                if (typeof object.rid !== "object")
                    throw TypeError(".database_blob.DatabaseBlobRowDocument.rid: object expected");
                message.rid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.rid);
            }
            if (object.deleted != null)
                message.deleted = Boolean(object.deleted);
            if (object.docState != null) {
                if (typeof object.docState !== "object")
                    throw TypeError(".database_blob.DatabaseBlobRowDocument.docState: object expected");
                message.docState = $root.database_blob.CollabDocState.fromObject(object.docState);
            }
            return message;
        };

        /**
         * Creates a plain object from a DatabaseBlobRowDocument message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {database_blob.DatabaseBlobRowDocument} message DatabaseBlobRowDocument
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        DatabaseBlobRowDocument.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if (options.bytes === String)
                    object.documentId = "";
                else {
                    object.documentId = [];
                    if (options.bytes !== Array)
                        object.documentId = $util.newBuffer(object.documentId);
                }
                object.rid = null;
                object.deleted = false;
                object.docState = null;
            }
            if (message.documentId != null && message.hasOwnProperty("documentId"))
                object.documentId = options.bytes === String ? $util.base64.encode(message.documentId, 0, message.documentId.length) : options.bytes === Array ? Array.prototype.slice.call(message.documentId) : message.documentId;
            if (message.rid != null && message.hasOwnProperty("rid"))
                object.rid = $root.database_blob.DatabaseBlobRowRid.toObject(message.rid, options);
            if (message.deleted != null && message.hasOwnProperty("deleted"))
                object.deleted = message.deleted;
            if (message.docState != null && message.hasOwnProperty("docState"))
                object.docState = $root.database_blob.CollabDocState.toObject(message.docState, options);
            return object;
        };

        /**
         * Converts this DatabaseBlobRowDocument to JSON.
         * @function toJSON
         * @memberof database_blob.DatabaseBlobRowDocument
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        DatabaseBlobRowDocument.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for DatabaseBlobRowDocument
         * @function getTypeUrl
         * @memberof database_blob.DatabaseBlobRowDocument
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        DatabaseBlobRowDocument.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.DatabaseBlobRowDocument";
        };

        return DatabaseBlobRowDocument;
    })();

    database_blob.DatabaseBlobRowUpdate = (function() {

        /**
         * Properties of a DatabaseBlobRowUpdate.
         * @memberof database_blob
         * @interface IDatabaseBlobRowUpdate
         * @property {Uint8Array|null} [rowId] DatabaseBlobRowUpdate rowId
         * @property {database_blob.IDatabaseBlobRowRid|null} [rid] DatabaseBlobRowUpdate rid
         * @property {database_blob.ICollabDocState|null} [docState] DatabaseBlobRowUpdate docState
         * @property {database_blob.IDatabaseBlobRowDocument|null} [document] DatabaseBlobRowUpdate document
         */

        /**
         * Constructs a new DatabaseBlobRowUpdate.
         * @memberof database_blob
         * @classdesc Represents a DatabaseBlobRowUpdate.
         * @implements IDatabaseBlobRowUpdate
         * @constructor
         * @param {database_blob.IDatabaseBlobRowUpdate=} [properties] Properties to set
         */
        function DatabaseBlobRowUpdate(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * DatabaseBlobRowUpdate rowId.
         * @member {Uint8Array} rowId
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @instance
         */
        DatabaseBlobRowUpdate.prototype.rowId = $util.newBuffer([]);

        /**
         * DatabaseBlobRowUpdate rid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} rid
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @instance
         */
        DatabaseBlobRowUpdate.prototype.rid = null;

        /**
         * DatabaseBlobRowUpdate docState.
         * @member {database_blob.ICollabDocState|null|undefined} docState
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @instance
         */
        DatabaseBlobRowUpdate.prototype.docState = null;

        /**
         * DatabaseBlobRowUpdate document.
         * @member {database_blob.IDatabaseBlobRowDocument|null|undefined} document
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @instance
         */
        DatabaseBlobRowUpdate.prototype.document = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * DatabaseBlobRowUpdate _document.
         * @member {"document"|undefined} _document
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @instance
         */
        Object.defineProperty(DatabaseBlobRowUpdate.prototype, "_document", {
            get: $util.oneOfGetter($oneOfFields = ["document"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new DatabaseBlobRowUpdate instance using the specified properties.
         * @function create
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {database_blob.IDatabaseBlobRowUpdate=} [properties] Properties to set
         * @returns {database_blob.DatabaseBlobRowUpdate} DatabaseBlobRowUpdate instance
         */
        DatabaseBlobRowUpdate.create = function create(properties) {
            return new DatabaseBlobRowUpdate(properties);
        };

        /**
         * Encodes the specified DatabaseBlobRowUpdate message. Does not implicitly {@link database_blob.DatabaseBlobRowUpdate.verify|verify} messages.
         * @function encode
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {database_blob.IDatabaseBlobRowUpdate} message DatabaseBlobRowUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowUpdate.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.rowId != null && Object.hasOwnProperty.call(message, "rowId"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.rowId);
            if (message.rid != null && Object.hasOwnProperty.call(message, "rid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.rid, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.docState != null && Object.hasOwnProperty.call(message, "docState"))
                $root.database_blob.CollabDocState.encode(message.docState, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.document != null && Object.hasOwnProperty.call(message, "document"))
                $root.database_blob.DatabaseBlobRowDocument.encode(message.document, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified DatabaseBlobRowUpdate message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowUpdate.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {database_blob.IDatabaseBlobRowUpdate} message DatabaseBlobRowUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowUpdate.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a DatabaseBlobRowUpdate message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.DatabaseBlobRowUpdate} DatabaseBlobRowUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowUpdate.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.DatabaseBlobRowUpdate();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.rowId = reader.bytes();
                        break;
                    }
                case 2: {
                        message.rid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.docState = $root.database_blob.CollabDocState.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.document = $root.database_blob.DatabaseBlobRowDocument.decode(reader, reader.uint32());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a DatabaseBlobRowUpdate message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.DatabaseBlobRowUpdate} DatabaseBlobRowUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowUpdate.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a DatabaseBlobRowUpdate message.
         * @function verify
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        DatabaseBlobRowUpdate.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.rowId != null && message.hasOwnProperty("rowId"))
                if (!(message.rowId && typeof message.rowId.length === "number" || $util.isString(message.rowId)))
                    return "rowId: buffer expected";
            if (message.rid != null && message.hasOwnProperty("rid")) {
                let error = $root.database_blob.DatabaseBlobRowRid.verify(message.rid);
                if (error)
                    return "rid." + error;
            }
            if (message.docState != null && message.hasOwnProperty("docState")) {
                let error = $root.database_blob.CollabDocState.verify(message.docState);
                if (error)
                    return "docState." + error;
            }
            if (message.document != null && message.hasOwnProperty("document")) {
                properties._document = 1;
                {
                    let error = $root.database_blob.DatabaseBlobRowDocument.verify(message.document);
                    if (error)
                        return "document." + error;
                }
            }
            return null;
        };

        /**
         * Creates a DatabaseBlobRowUpdate message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.DatabaseBlobRowUpdate} DatabaseBlobRowUpdate
         */
        DatabaseBlobRowUpdate.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.DatabaseBlobRowUpdate)
                return object;
            let message = new $root.database_blob.DatabaseBlobRowUpdate();
            if (object.rowId != null)
                if (typeof object.rowId === "string")
                    $util.base64.decode(object.rowId, message.rowId = $util.newBuffer($util.base64.length(object.rowId)), 0);
                else if (object.rowId.length >= 0)
                    message.rowId = object.rowId;
            if (object.rid != null) {
                if (typeof object.rid !== "object")
                    throw TypeError(".database_blob.DatabaseBlobRowUpdate.rid: object expected");
                message.rid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.rid);
            }
            if (object.docState != null) {
                if (typeof object.docState !== "object")
                    throw TypeError(".database_blob.DatabaseBlobRowUpdate.docState: object expected");
                message.docState = $root.database_blob.CollabDocState.fromObject(object.docState);
            }
            if (object.document != null) {
                if (typeof object.document !== "object")
                    throw TypeError(".database_blob.DatabaseBlobRowUpdate.document: object expected");
                message.document = $root.database_blob.DatabaseBlobRowDocument.fromObject(object.document);
            }
            return message;
        };

        /**
         * Creates a plain object from a DatabaseBlobRowUpdate message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {database_blob.DatabaseBlobRowUpdate} message DatabaseBlobRowUpdate
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        DatabaseBlobRowUpdate.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if (options.bytes === String)
                    object.rowId = "";
                else {
                    object.rowId = [];
                    if (options.bytes !== Array)
                        object.rowId = $util.newBuffer(object.rowId);
                }
                object.rid = null;
                object.docState = null;
            }
            if (message.rowId != null && message.hasOwnProperty("rowId"))
                object.rowId = options.bytes === String ? $util.base64.encode(message.rowId, 0, message.rowId.length) : options.bytes === Array ? Array.prototype.slice.call(message.rowId) : message.rowId;
            if (message.rid != null && message.hasOwnProperty("rid"))
                object.rid = $root.database_blob.DatabaseBlobRowRid.toObject(message.rid, options);
            if (message.docState != null && message.hasOwnProperty("docState"))
                object.docState = $root.database_blob.CollabDocState.toObject(message.docState, options);
            if (message.document != null && message.hasOwnProperty("document")) {
                object.document = $root.database_blob.DatabaseBlobRowDocument.toObject(message.document, options);
                if (options.oneofs)
                    object._document = "document";
            }
            return object;
        };

        /**
         * Converts this DatabaseBlobRowUpdate to JSON.
         * @function toJSON
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        DatabaseBlobRowUpdate.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for DatabaseBlobRowUpdate
         * @function getTypeUrl
         * @memberof database_blob.DatabaseBlobRowUpdate
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        DatabaseBlobRowUpdate.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.DatabaseBlobRowUpdate";
        };

        return DatabaseBlobRowUpdate;
    })();

    database_blob.DatabaseBlobRowDelete = (function() {

        /**
         * Properties of a DatabaseBlobRowDelete.
         * @memberof database_blob
         * @interface IDatabaseBlobRowDelete
         * @property {Uint8Array|null} [rowId] DatabaseBlobRowDelete rowId
         * @property {database_blob.IDatabaseBlobRowRid|null} [rid] DatabaseBlobRowDelete rid
         */

        /**
         * Constructs a new DatabaseBlobRowDelete.
         * @memberof database_blob
         * @classdesc Represents a DatabaseBlobRowDelete.
         * @implements IDatabaseBlobRowDelete
         * @constructor
         * @param {database_blob.IDatabaseBlobRowDelete=} [properties] Properties to set
         */
        function DatabaseBlobRowDelete(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * DatabaseBlobRowDelete rowId.
         * @member {Uint8Array} rowId
         * @memberof database_blob.DatabaseBlobRowDelete
         * @instance
         */
        DatabaseBlobRowDelete.prototype.rowId = $util.newBuffer([]);

        /**
         * DatabaseBlobRowDelete rid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} rid
         * @memberof database_blob.DatabaseBlobRowDelete
         * @instance
         */
        DatabaseBlobRowDelete.prototype.rid = null;

        /**
         * Creates a new DatabaseBlobRowDelete instance using the specified properties.
         * @function create
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {database_blob.IDatabaseBlobRowDelete=} [properties] Properties to set
         * @returns {database_blob.DatabaseBlobRowDelete} DatabaseBlobRowDelete instance
         */
        DatabaseBlobRowDelete.create = function create(properties) {
            return new DatabaseBlobRowDelete(properties);
        };

        /**
         * Encodes the specified DatabaseBlobRowDelete message. Does not implicitly {@link database_blob.DatabaseBlobRowDelete.verify|verify} messages.
         * @function encode
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {database_blob.IDatabaseBlobRowDelete} message DatabaseBlobRowDelete message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowDelete.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.rowId != null && Object.hasOwnProperty.call(message, "rowId"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.rowId);
            if (message.rid != null && Object.hasOwnProperty.call(message, "rid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.rid, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified DatabaseBlobRowDelete message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowDelete.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {database_blob.IDatabaseBlobRowDelete} message DatabaseBlobRowDelete message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobRowDelete.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a DatabaseBlobRowDelete message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.DatabaseBlobRowDelete} DatabaseBlobRowDelete
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowDelete.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.DatabaseBlobRowDelete();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.rowId = reader.bytes();
                        break;
                    }
                case 2: {
                        message.rid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a DatabaseBlobRowDelete message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.DatabaseBlobRowDelete} DatabaseBlobRowDelete
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobRowDelete.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a DatabaseBlobRowDelete message.
         * @function verify
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        DatabaseBlobRowDelete.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.rowId != null && message.hasOwnProperty("rowId"))
                if (!(message.rowId && typeof message.rowId.length === "number" || $util.isString(message.rowId)))
                    return "rowId: buffer expected";
            if (message.rid != null && message.hasOwnProperty("rid")) {
                let error = $root.database_blob.DatabaseBlobRowRid.verify(message.rid);
                if (error)
                    return "rid." + error;
            }
            return null;
        };

        /**
         * Creates a DatabaseBlobRowDelete message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.DatabaseBlobRowDelete} DatabaseBlobRowDelete
         */
        DatabaseBlobRowDelete.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.DatabaseBlobRowDelete)
                return object;
            let message = new $root.database_blob.DatabaseBlobRowDelete();
            if (object.rowId != null)
                if (typeof object.rowId === "string")
                    $util.base64.decode(object.rowId, message.rowId = $util.newBuffer($util.base64.length(object.rowId)), 0);
                else if (object.rowId.length >= 0)
                    message.rowId = object.rowId;
            if (object.rid != null) {
                if (typeof object.rid !== "object")
                    throw TypeError(".database_blob.DatabaseBlobRowDelete.rid: object expected");
                message.rid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.rid);
            }
            return message;
        };

        /**
         * Creates a plain object from a DatabaseBlobRowDelete message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {database_blob.DatabaseBlobRowDelete} message DatabaseBlobRowDelete
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        DatabaseBlobRowDelete.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if (options.bytes === String)
                    object.rowId = "";
                else {
                    object.rowId = [];
                    if (options.bytes !== Array)
                        object.rowId = $util.newBuffer(object.rowId);
                }
                object.rid = null;
            }
            if (message.rowId != null && message.hasOwnProperty("rowId"))
                object.rowId = options.bytes === String ? $util.base64.encode(message.rowId, 0, message.rowId.length) : options.bytes === Array ? Array.prototype.slice.call(message.rowId) : message.rowId;
            if (message.rid != null && message.hasOwnProperty("rid"))
                object.rid = $root.database_blob.DatabaseBlobRowRid.toObject(message.rid, options);
            return object;
        };

        /**
         * Converts this DatabaseBlobRowDelete to JSON.
         * @function toJSON
         * @memberof database_blob.DatabaseBlobRowDelete
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        DatabaseBlobRowDelete.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for DatabaseBlobRowDelete
         * @function getTypeUrl
         * @memberof database_blob.DatabaseBlobRowDelete
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        DatabaseBlobRowDelete.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.DatabaseBlobRowDelete";
        };

        return DatabaseBlobRowDelete;
    })();

    database_blob.DatabaseBlobDiffResponse = (function() {

        /**
         * Properties of a DatabaseBlobDiffResponse.
         * @memberof database_blob
         * @interface IDatabaseBlobDiffResponse
         * @property {string|null} [manifestVersion] DatabaseBlobDiffResponse manifestVersion
         * @property {string|null} [headBlobKey] DatabaseBlobDiffResponse headBlobKey
         * @property {Array.<database_blob.IDatabaseBlobRowUpdate>|null} [updates] DatabaseBlobDiffResponse updates
         * @property {Array.<database_blob.IDatabaseBlobRowDelete>|null} [deletes] DatabaseBlobDiffResponse deletes
         * @property {Array.<database_blob.IDatabaseBlobRowUpdate>|null} [creates] DatabaseBlobDiffResponse creates
         * @property {database_blob.DiffStatus|null} [status] DatabaseBlobDiffResponse status
         * @property {number|null} [retryAfterSecs] DatabaseBlobDiffResponse retryAfterSecs
         * @property {string|null} [message] DatabaseBlobDiffResponse message
         */

        /**
         * Constructs a new DatabaseBlobDiffResponse.
         * @memberof database_blob
         * @classdesc Represents a DatabaseBlobDiffResponse.
         * @implements IDatabaseBlobDiffResponse
         * @constructor
         * @param {database_blob.IDatabaseBlobDiffResponse=} [properties] Properties to set
         */
        function DatabaseBlobDiffResponse(properties) {
            this.updates = [];
            this.deletes = [];
            this.creates = [];
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * DatabaseBlobDiffResponse manifestVersion.
         * @member {string} manifestVersion
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.manifestVersion = "";

        /**
         * DatabaseBlobDiffResponse headBlobKey.
         * @member {string|null|undefined} headBlobKey
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.headBlobKey = null;

        /**
         * DatabaseBlobDiffResponse updates.
         * @member {Array.<database_blob.IDatabaseBlobRowUpdate>} updates
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.updates = $util.emptyArray;

        /**
         * DatabaseBlobDiffResponse deletes.
         * @member {Array.<database_blob.IDatabaseBlobRowDelete>} deletes
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.deletes = $util.emptyArray;

        /**
         * DatabaseBlobDiffResponse creates.
         * @member {Array.<database_blob.IDatabaseBlobRowUpdate>} creates
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.creates = $util.emptyArray;

        /**
         * DatabaseBlobDiffResponse status.
         * @member {database_blob.DiffStatus} status
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.status = 0;

        /**
         * DatabaseBlobDiffResponse retryAfterSecs.
         * @member {number|null|undefined} retryAfterSecs
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.retryAfterSecs = null;

        /**
         * DatabaseBlobDiffResponse message.
         * @member {string|null|undefined} message
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        DatabaseBlobDiffResponse.prototype.message = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * DatabaseBlobDiffResponse _headBlobKey.
         * @member {"headBlobKey"|undefined} _headBlobKey
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        Object.defineProperty(DatabaseBlobDiffResponse.prototype, "_headBlobKey", {
            get: $util.oneOfGetter($oneOfFields = ["headBlobKey"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * DatabaseBlobDiffResponse _retryAfterSecs.
         * @member {"retryAfterSecs"|undefined} _retryAfterSecs
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        Object.defineProperty(DatabaseBlobDiffResponse.prototype, "_retryAfterSecs", {
            get: $util.oneOfGetter($oneOfFields = ["retryAfterSecs"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * DatabaseBlobDiffResponse _message.
         * @member {"message"|undefined} _message
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         */
        Object.defineProperty(DatabaseBlobDiffResponse.prototype, "_message", {
            get: $util.oneOfGetter($oneOfFields = ["message"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new DatabaseBlobDiffResponse instance using the specified properties.
         * @function create
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {database_blob.IDatabaseBlobDiffResponse=} [properties] Properties to set
         * @returns {database_blob.DatabaseBlobDiffResponse} DatabaseBlobDiffResponse instance
         */
        DatabaseBlobDiffResponse.create = function create(properties) {
            return new DatabaseBlobDiffResponse(properties);
        };

        /**
         * Encodes the specified DatabaseBlobDiffResponse message. Does not implicitly {@link database_blob.DatabaseBlobDiffResponse.verify|verify} messages.
         * @function encode
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {database_blob.IDatabaseBlobDiffResponse} message DatabaseBlobDiffResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobDiffResponse.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.manifestVersion != null && Object.hasOwnProperty.call(message, "manifestVersion"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.manifestVersion);
            if (message.headBlobKey != null && Object.hasOwnProperty.call(message, "headBlobKey"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.headBlobKey);
            if (message.updates != null && message.updates.length)
                for (let i = 0; i < message.updates.length; ++i)
                    $root.database_blob.DatabaseBlobRowUpdate.encode(message.updates[i], writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.deletes != null && message.deletes.length)
                for (let i = 0; i < message.deletes.length; ++i)
                    $root.database_blob.DatabaseBlobRowDelete.encode(message.deletes[i], writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.creates != null && message.creates.length)
                for (let i = 0; i < message.creates.length; ++i)
                    $root.database_blob.DatabaseBlobRowUpdate.encode(message.creates[i], writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            if (message.status != null && Object.hasOwnProperty.call(message, "status"))
                writer.uint32(/* id 6, wireType 0 =*/48).int32(message.status);
            if (message.retryAfterSecs != null && Object.hasOwnProperty.call(message, "retryAfterSecs"))
                writer.uint32(/* id 7, wireType 0 =*/56).uint32(message.retryAfterSecs);
            if (message.message != null && Object.hasOwnProperty.call(message, "message"))
                writer.uint32(/* id 8, wireType 2 =*/66).string(message.message);
            return writer;
        };

        /**
         * Encodes the specified DatabaseBlobDiffResponse message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobDiffResponse.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {database_blob.IDatabaseBlobDiffResponse} message DatabaseBlobDiffResponse message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobDiffResponse.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a DatabaseBlobDiffResponse message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.DatabaseBlobDiffResponse} DatabaseBlobDiffResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobDiffResponse.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.DatabaseBlobDiffResponse();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.manifestVersion = reader.string();
                        break;
                    }
                case 2: {
                        message.headBlobKey = reader.string();
                        break;
                    }
                case 3: {
                        if (!(message.updates && message.updates.length))
                            message.updates = [];
                        message.updates.push($root.database_blob.DatabaseBlobRowUpdate.decode(reader, reader.uint32()));
                        break;
                    }
                case 4: {
                        if (!(message.deletes && message.deletes.length))
                            message.deletes = [];
                        message.deletes.push($root.database_blob.DatabaseBlobRowDelete.decode(reader, reader.uint32()));
                        break;
                    }
                case 5: {
                        if (!(message.creates && message.creates.length))
                            message.creates = [];
                        message.creates.push($root.database_blob.DatabaseBlobRowUpdate.decode(reader, reader.uint32()));
                        break;
                    }
                case 6: {
                        message.status = reader.int32();
                        break;
                    }
                case 7: {
                        message.retryAfterSecs = reader.uint32();
                        break;
                    }
                case 8: {
                        message.message = reader.string();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a DatabaseBlobDiffResponse message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.DatabaseBlobDiffResponse} DatabaseBlobDiffResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobDiffResponse.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a DatabaseBlobDiffResponse message.
         * @function verify
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        DatabaseBlobDiffResponse.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.manifestVersion != null && message.hasOwnProperty("manifestVersion"))
                if (!$util.isString(message.manifestVersion))
                    return "manifestVersion: string expected";
            if (message.headBlobKey != null && message.hasOwnProperty("headBlobKey")) {
                properties._headBlobKey = 1;
                if (!$util.isString(message.headBlobKey))
                    return "headBlobKey: string expected";
            }
            if (message.updates != null && message.hasOwnProperty("updates")) {
                if (!Array.isArray(message.updates))
                    return "updates: array expected";
                for (let i = 0; i < message.updates.length; ++i) {
                    let error = $root.database_blob.DatabaseBlobRowUpdate.verify(message.updates[i]);
                    if (error)
                        return "updates." + error;
                }
            }
            if (message.deletes != null && message.hasOwnProperty("deletes")) {
                if (!Array.isArray(message.deletes))
                    return "deletes: array expected";
                for (let i = 0; i < message.deletes.length; ++i) {
                    let error = $root.database_blob.DatabaseBlobRowDelete.verify(message.deletes[i]);
                    if (error)
                        return "deletes." + error;
                }
            }
            if (message.creates != null && message.hasOwnProperty("creates")) {
                if (!Array.isArray(message.creates))
                    return "creates: array expected";
                for (let i = 0; i < message.creates.length; ++i) {
                    let error = $root.database_blob.DatabaseBlobRowUpdate.verify(message.creates[i]);
                    if (error)
                        return "creates." + error;
                }
            }
            if (message.status != null && message.hasOwnProperty("status"))
                switch (message.status) {
                default:
                    return "status: enum value expected";
                case 0:
                case 1:
                    break;
                }
            if (message.retryAfterSecs != null && message.hasOwnProperty("retryAfterSecs")) {
                properties._retryAfterSecs = 1;
                if (!$util.isInteger(message.retryAfterSecs))
                    return "retryAfterSecs: integer expected";
            }
            if (message.message != null && message.hasOwnProperty("message")) {
                properties._message = 1;
                if (!$util.isString(message.message))
                    return "message: string expected";
            }
            return null;
        };

        /**
         * Creates a DatabaseBlobDiffResponse message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.DatabaseBlobDiffResponse} DatabaseBlobDiffResponse
         */
        DatabaseBlobDiffResponse.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.DatabaseBlobDiffResponse)
                return object;
            let message = new $root.database_blob.DatabaseBlobDiffResponse();
            if (object.manifestVersion != null)
                message.manifestVersion = String(object.manifestVersion);
            if (object.headBlobKey != null)
                message.headBlobKey = String(object.headBlobKey);
            if (object.updates) {
                if (!Array.isArray(object.updates))
                    throw TypeError(".database_blob.DatabaseBlobDiffResponse.updates: array expected");
                message.updates = [];
                for (let i = 0; i < object.updates.length; ++i) {
                    if (typeof object.updates[i] !== "object")
                        throw TypeError(".database_blob.DatabaseBlobDiffResponse.updates: object expected");
                    message.updates[i] = $root.database_blob.DatabaseBlobRowUpdate.fromObject(object.updates[i]);
                }
            }
            if (object.deletes) {
                if (!Array.isArray(object.deletes))
                    throw TypeError(".database_blob.DatabaseBlobDiffResponse.deletes: array expected");
                message.deletes = [];
                for (let i = 0; i < object.deletes.length; ++i) {
                    if (typeof object.deletes[i] !== "object")
                        throw TypeError(".database_blob.DatabaseBlobDiffResponse.deletes: object expected");
                    message.deletes[i] = $root.database_blob.DatabaseBlobRowDelete.fromObject(object.deletes[i]);
                }
            }
            if (object.creates) {
                if (!Array.isArray(object.creates))
                    throw TypeError(".database_blob.DatabaseBlobDiffResponse.creates: array expected");
                message.creates = [];
                for (let i = 0; i < object.creates.length; ++i) {
                    if (typeof object.creates[i] !== "object")
                        throw TypeError(".database_blob.DatabaseBlobDiffResponse.creates: object expected");
                    message.creates[i] = $root.database_blob.DatabaseBlobRowUpdate.fromObject(object.creates[i]);
                }
            }
            switch (object.status) {
            default:
                if (typeof object.status === "number") {
                    message.status = object.status;
                    break;
                }
                break;
            case "READY":
            case 0:
                message.status = 0;
                break;
            case "PENDING":
            case 1:
                message.status = 1;
                break;
            }
            if (object.retryAfterSecs != null)
                message.retryAfterSecs = object.retryAfterSecs >>> 0;
            if (object.message != null)
                message.message = String(object.message);
            return message;
        };

        /**
         * Creates a plain object from a DatabaseBlobDiffResponse message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {database_blob.DatabaseBlobDiffResponse} message DatabaseBlobDiffResponse
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        DatabaseBlobDiffResponse.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.arrays || options.defaults) {
                object.updates = [];
                object.deletes = [];
                object.creates = [];
            }
            if (options.defaults) {
                object.manifestVersion = "";
                object.status = options.enums === String ? "READY" : 0;
            }
            if (message.manifestVersion != null && message.hasOwnProperty("manifestVersion"))
                object.manifestVersion = message.manifestVersion;
            if (message.headBlobKey != null && message.hasOwnProperty("headBlobKey")) {
                object.headBlobKey = message.headBlobKey;
                if (options.oneofs)
                    object._headBlobKey = "headBlobKey";
            }
            if (message.updates && message.updates.length) {
                object.updates = [];
                for (let j = 0; j < message.updates.length; ++j)
                    object.updates[j] = $root.database_blob.DatabaseBlobRowUpdate.toObject(message.updates[j], options);
            }
            if (message.deletes && message.deletes.length) {
                object.deletes = [];
                for (let j = 0; j < message.deletes.length; ++j)
                    object.deletes[j] = $root.database_blob.DatabaseBlobRowDelete.toObject(message.deletes[j], options);
            }
            if (message.creates && message.creates.length) {
                object.creates = [];
                for (let j = 0; j < message.creates.length; ++j)
                    object.creates[j] = $root.database_blob.DatabaseBlobRowUpdate.toObject(message.creates[j], options);
            }
            if (message.status != null && message.hasOwnProperty("status"))
                object.status = options.enums === String ? $root.database_blob.DiffStatus[message.status] === undefined ? message.status : $root.database_blob.DiffStatus[message.status] : message.status;
            if (message.retryAfterSecs != null && message.hasOwnProperty("retryAfterSecs")) {
                object.retryAfterSecs = message.retryAfterSecs;
                if (options.oneofs)
                    object._retryAfterSecs = "retryAfterSecs";
            }
            if (message.message != null && message.hasOwnProperty("message")) {
                object.message = message.message;
                if (options.oneofs)
                    object._message = "message";
            }
            return object;
        };

        /**
         * Converts this DatabaseBlobDiffResponse to JSON.
         * @function toJSON
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        DatabaseBlobDiffResponse.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for DatabaseBlobDiffResponse
         * @function getTypeUrl
         * @memberof database_blob.DatabaseBlobDiffResponse
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        DatabaseBlobDiffResponse.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.DatabaseBlobDiffResponse";
        };

        return DatabaseBlobDiffResponse;
    })();

    database_blob.BlobDescriptor = (function() {

        /**
         * Properties of a BlobDescriptor.
         * @memberof database_blob
         * @interface IBlobDescriptor
         * @property {string|null} [key] BlobDescriptor key
         * @property {database_blob.IDatabaseBlobRowRid|null} [startRid] BlobDescriptor startRid
         * @property {database_blob.IDatabaseBlobRowRid|null} [endRid] BlobDescriptor endRid
         * @property {number|Long|null} [totalBytes] BlobDescriptor totalBytes
         * @property {boolean|null} [sealed] BlobDescriptor sealed
         */

        /**
         * Constructs a new BlobDescriptor.
         * @memberof database_blob
         * @classdesc Represents a BlobDescriptor.
         * @implements IBlobDescriptor
         * @constructor
         * @param {database_blob.IBlobDescriptor=} [properties] Properties to set
         */
        function BlobDescriptor(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * BlobDescriptor key.
         * @member {string} key
         * @memberof database_blob.BlobDescriptor
         * @instance
         */
        BlobDescriptor.prototype.key = "";

        /**
         * BlobDescriptor startRid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} startRid
         * @memberof database_blob.BlobDescriptor
         * @instance
         */
        BlobDescriptor.prototype.startRid = null;

        /**
         * BlobDescriptor endRid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} endRid
         * @memberof database_blob.BlobDescriptor
         * @instance
         */
        BlobDescriptor.prototype.endRid = null;

        /**
         * BlobDescriptor totalBytes.
         * @member {number|Long} totalBytes
         * @memberof database_blob.BlobDescriptor
         * @instance
         */
        BlobDescriptor.prototype.totalBytes = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * BlobDescriptor sealed.
         * @member {boolean} sealed
         * @memberof database_blob.BlobDescriptor
         * @instance
         */
        BlobDescriptor.prototype.sealed = false;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * BlobDescriptor _startRid.
         * @member {"startRid"|undefined} _startRid
         * @memberof database_blob.BlobDescriptor
         * @instance
         */
        Object.defineProperty(BlobDescriptor.prototype, "_startRid", {
            get: $util.oneOfGetter($oneOfFields = ["startRid"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * BlobDescriptor _endRid.
         * @member {"endRid"|undefined} _endRid
         * @memberof database_blob.BlobDescriptor
         * @instance
         */
        Object.defineProperty(BlobDescriptor.prototype, "_endRid", {
            get: $util.oneOfGetter($oneOfFields = ["endRid"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new BlobDescriptor instance using the specified properties.
         * @function create
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {database_blob.IBlobDescriptor=} [properties] Properties to set
         * @returns {database_blob.BlobDescriptor} BlobDescriptor instance
         */
        BlobDescriptor.create = function create(properties) {
            return new BlobDescriptor(properties);
        };

        /**
         * Encodes the specified BlobDescriptor message. Does not implicitly {@link database_blob.BlobDescriptor.verify|verify} messages.
         * @function encode
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {database_blob.IBlobDescriptor} message BlobDescriptor message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        BlobDescriptor.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.key != null && Object.hasOwnProperty.call(message, "key"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.key);
            if (message.startRid != null && Object.hasOwnProperty.call(message, "startRid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.startRid, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.endRid != null && Object.hasOwnProperty.call(message, "endRid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.endRid, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.totalBytes != null && Object.hasOwnProperty.call(message, "totalBytes"))
                writer.uint32(/* id 4, wireType 0 =*/32).uint64(message.totalBytes);
            if (message.sealed != null && Object.hasOwnProperty.call(message, "sealed"))
                writer.uint32(/* id 5, wireType 0 =*/40).bool(message.sealed);
            return writer;
        };

        /**
         * Encodes the specified BlobDescriptor message, length delimited. Does not implicitly {@link database_blob.BlobDescriptor.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {database_blob.IBlobDescriptor} message BlobDescriptor message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        BlobDescriptor.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a BlobDescriptor message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.BlobDescriptor} BlobDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        BlobDescriptor.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.BlobDescriptor();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.key = reader.string();
                        break;
                    }
                case 2: {
                        message.startRid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.endRid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.totalBytes = reader.uint64();
                        break;
                    }
                case 5: {
                        message.sealed = reader.bool();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a BlobDescriptor message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.BlobDescriptor} BlobDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        BlobDescriptor.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a BlobDescriptor message.
         * @function verify
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        BlobDescriptor.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.key != null && message.hasOwnProperty("key"))
                if (!$util.isString(message.key))
                    return "key: string expected";
            if (message.startRid != null && message.hasOwnProperty("startRid")) {
                properties._startRid = 1;
                {
                    let error = $root.database_blob.DatabaseBlobRowRid.verify(message.startRid);
                    if (error)
                        return "startRid." + error;
                }
            }
            if (message.endRid != null && message.hasOwnProperty("endRid")) {
                properties._endRid = 1;
                {
                    let error = $root.database_blob.DatabaseBlobRowRid.verify(message.endRid);
                    if (error)
                        return "endRid." + error;
                }
            }
            if (message.totalBytes != null && message.hasOwnProperty("totalBytes"))
                if (!$util.isInteger(message.totalBytes) && !(message.totalBytes && $util.isInteger(message.totalBytes.low) && $util.isInteger(message.totalBytes.high)))
                    return "totalBytes: integer|Long expected";
            if (message.sealed != null && message.hasOwnProperty("sealed"))
                if (typeof message.sealed !== "boolean")
                    return "sealed: boolean expected";
            return null;
        };

        /**
         * Creates a BlobDescriptor message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.BlobDescriptor} BlobDescriptor
         */
        BlobDescriptor.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.BlobDescriptor)
                return object;
            let message = new $root.database_blob.BlobDescriptor();
            if (object.key != null)
                message.key = String(object.key);
            if (object.startRid != null) {
                if (typeof object.startRid !== "object")
                    throw TypeError(".database_blob.BlobDescriptor.startRid: object expected");
                message.startRid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.startRid);
            }
            if (object.endRid != null) {
                if (typeof object.endRid !== "object")
                    throw TypeError(".database_blob.BlobDescriptor.endRid: object expected");
                message.endRid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.endRid);
            }
            if (object.totalBytes != null)
                if ($util.Long)
                    (message.totalBytes = $util.Long.fromValue(object.totalBytes)).unsigned = true;
                else if (typeof object.totalBytes === "string")
                    message.totalBytes = parseInt(object.totalBytes, 10);
                else if (typeof object.totalBytes === "number")
                    message.totalBytes = object.totalBytes;
                else if (typeof object.totalBytes === "object")
                    message.totalBytes = new $util.LongBits(object.totalBytes.low >>> 0, object.totalBytes.high >>> 0).toNumber(true);
            if (object.sealed != null)
                message.sealed = Boolean(object.sealed);
            return message;
        };

        /**
         * Creates a plain object from a BlobDescriptor message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {database_blob.BlobDescriptor} message BlobDescriptor
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        BlobDescriptor.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.key = "";
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.totalBytes = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.totalBytes = options.longs === String ? "0" : 0;
                object.sealed = false;
            }
            if (message.key != null && message.hasOwnProperty("key"))
                object.key = message.key;
            if (message.startRid != null && message.hasOwnProperty("startRid")) {
                object.startRid = $root.database_blob.DatabaseBlobRowRid.toObject(message.startRid, options);
                if (options.oneofs)
                    object._startRid = "startRid";
            }
            if (message.endRid != null && message.hasOwnProperty("endRid")) {
                object.endRid = $root.database_blob.DatabaseBlobRowRid.toObject(message.endRid, options);
                if (options.oneofs)
                    object._endRid = "endRid";
            }
            if (message.totalBytes != null && message.hasOwnProperty("totalBytes"))
                if (typeof message.totalBytes === "number")
                    object.totalBytes = options.longs === String ? String(message.totalBytes) : message.totalBytes;
                else
                    object.totalBytes = options.longs === String ? $util.Long.prototype.toString.call(message.totalBytes) : options.longs === Number ? new $util.LongBits(message.totalBytes.low >>> 0, message.totalBytes.high >>> 0).toNumber(true) : message.totalBytes;
            if (message.sealed != null && message.hasOwnProperty("sealed"))
                object.sealed = message.sealed;
            return object;
        };

        /**
         * Converts this BlobDescriptor to JSON.
         * @function toJSON
         * @memberof database_blob.BlobDescriptor
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        BlobDescriptor.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for BlobDescriptor
         * @function getTypeUrl
         * @memberof database_blob.BlobDescriptor
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        BlobDescriptor.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.BlobDescriptor";
        };

        return BlobDescriptor;
    })();

    database_blob.ManifestRowDocumentPointer = (function() {

        /**
         * Properties of a ManifestRowDocumentPointer.
         * @memberof database_blob
         * @interface IManifestRowDocumentPointer
         * @property {Uint8Array|null} [documentId] ManifestRowDocumentPointer documentId
         * @property {database_blob.IDatabaseBlobRowRid|null} [rid] ManifestRowDocumentPointer rid
         * @property {boolean|null} [deleted] ManifestRowDocumentPointer deleted
         */

        /**
         * Constructs a new ManifestRowDocumentPointer.
         * @memberof database_blob
         * @classdesc Represents a ManifestRowDocumentPointer.
         * @implements IManifestRowDocumentPointer
         * @constructor
         * @param {database_blob.IManifestRowDocumentPointer=} [properties] Properties to set
         */
        function ManifestRowDocumentPointer(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ManifestRowDocumentPointer documentId.
         * @member {Uint8Array} documentId
         * @memberof database_blob.ManifestRowDocumentPointer
         * @instance
         */
        ManifestRowDocumentPointer.prototype.documentId = $util.newBuffer([]);

        /**
         * ManifestRowDocumentPointer rid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} rid
         * @memberof database_blob.ManifestRowDocumentPointer
         * @instance
         */
        ManifestRowDocumentPointer.prototype.rid = null;

        /**
         * ManifestRowDocumentPointer deleted.
         * @member {boolean} deleted
         * @memberof database_blob.ManifestRowDocumentPointer
         * @instance
         */
        ManifestRowDocumentPointer.prototype.deleted = false;

        /**
         * Creates a new ManifestRowDocumentPointer instance using the specified properties.
         * @function create
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {database_blob.IManifestRowDocumentPointer=} [properties] Properties to set
         * @returns {database_blob.ManifestRowDocumentPointer} ManifestRowDocumentPointer instance
         */
        ManifestRowDocumentPointer.create = function create(properties) {
            return new ManifestRowDocumentPointer(properties);
        };

        /**
         * Encodes the specified ManifestRowDocumentPointer message. Does not implicitly {@link database_blob.ManifestRowDocumentPointer.verify|verify} messages.
         * @function encode
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {database_blob.IManifestRowDocumentPointer} message ManifestRowDocumentPointer message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ManifestRowDocumentPointer.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.documentId != null && Object.hasOwnProperty.call(message, "documentId"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.documentId);
            if (message.rid != null && Object.hasOwnProperty.call(message, "rid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.rid, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.deleted != null && Object.hasOwnProperty.call(message, "deleted"))
                writer.uint32(/* id 3, wireType 0 =*/24).bool(message.deleted);
            return writer;
        };

        /**
         * Encodes the specified ManifestRowDocumentPointer message, length delimited. Does not implicitly {@link database_blob.ManifestRowDocumentPointer.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {database_blob.IManifestRowDocumentPointer} message ManifestRowDocumentPointer message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ManifestRowDocumentPointer.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a ManifestRowDocumentPointer message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.ManifestRowDocumentPointer} ManifestRowDocumentPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ManifestRowDocumentPointer.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.ManifestRowDocumentPointer();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.documentId = reader.bytes();
                        break;
                    }
                case 2: {
                        message.rid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.deleted = reader.bool();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a ManifestRowDocumentPointer message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.ManifestRowDocumentPointer} ManifestRowDocumentPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ManifestRowDocumentPointer.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a ManifestRowDocumentPointer message.
         * @function verify
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ManifestRowDocumentPointer.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.documentId != null && message.hasOwnProperty("documentId"))
                if (!(message.documentId && typeof message.documentId.length === "number" || $util.isString(message.documentId)))
                    return "documentId: buffer expected";
            if (message.rid != null && message.hasOwnProperty("rid")) {
                let error = $root.database_blob.DatabaseBlobRowRid.verify(message.rid);
                if (error)
                    return "rid." + error;
            }
            if (message.deleted != null && message.hasOwnProperty("deleted"))
                if (typeof message.deleted !== "boolean")
                    return "deleted: boolean expected";
            return null;
        };

        /**
         * Creates a ManifestRowDocumentPointer message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.ManifestRowDocumentPointer} ManifestRowDocumentPointer
         */
        ManifestRowDocumentPointer.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.ManifestRowDocumentPointer)
                return object;
            let message = new $root.database_blob.ManifestRowDocumentPointer();
            if (object.documentId != null)
                if (typeof object.documentId === "string")
                    $util.base64.decode(object.documentId, message.documentId = $util.newBuffer($util.base64.length(object.documentId)), 0);
                else if (object.documentId.length >= 0)
                    message.documentId = object.documentId;
            if (object.rid != null) {
                if (typeof object.rid !== "object")
                    throw TypeError(".database_blob.ManifestRowDocumentPointer.rid: object expected");
                message.rid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.rid);
            }
            if (object.deleted != null)
                message.deleted = Boolean(object.deleted);
            return message;
        };

        /**
         * Creates a plain object from a ManifestRowDocumentPointer message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {database_blob.ManifestRowDocumentPointer} message ManifestRowDocumentPointer
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ManifestRowDocumentPointer.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if (options.bytes === String)
                    object.documentId = "";
                else {
                    object.documentId = [];
                    if (options.bytes !== Array)
                        object.documentId = $util.newBuffer(object.documentId);
                }
                object.rid = null;
                object.deleted = false;
            }
            if (message.documentId != null && message.hasOwnProperty("documentId"))
                object.documentId = options.bytes === String ? $util.base64.encode(message.documentId, 0, message.documentId.length) : options.bytes === Array ? Array.prototype.slice.call(message.documentId) : message.documentId;
            if (message.rid != null && message.hasOwnProperty("rid"))
                object.rid = $root.database_blob.DatabaseBlobRowRid.toObject(message.rid, options);
            if (message.deleted != null && message.hasOwnProperty("deleted"))
                object.deleted = message.deleted;
            return object;
        };

        /**
         * Converts this ManifestRowDocumentPointer to JSON.
         * @function toJSON
         * @memberof database_blob.ManifestRowDocumentPointer
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ManifestRowDocumentPointer.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for ManifestRowDocumentPointer
         * @function getTypeUrl
         * @memberof database_blob.ManifestRowDocumentPointer
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        ManifestRowDocumentPointer.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.ManifestRowDocumentPointer";
        };

        return ManifestRowDocumentPointer;
    })();

    database_blob.ManifestRowPointer = (function() {

        /**
         * Properties of a ManifestRowPointer.
         * @memberof database_blob
         * @interface IManifestRowPointer
         * @property {Uint8Array|null} [rowId] ManifestRowPointer rowId
         * @property {number|null} [blobIndex] ManifestRowPointer blobIndex
         * @property {number|Long|null} [segmentOffset] ManifestRowPointer segmentOffset
         * @property {database_blob.IDatabaseBlobRowRid|null} [rid] ManifestRowPointer rid
         * @property {boolean|null} [deleted] ManifestRowPointer deleted
         * @property {database_blob.IManifestRowDocumentPointer|null} [document] ManifestRowPointer document
         */

        /**
         * Constructs a new ManifestRowPointer.
         * @memberof database_blob
         * @classdesc Represents a ManifestRowPointer.
         * @implements IManifestRowPointer
         * @constructor
         * @param {database_blob.IManifestRowPointer=} [properties] Properties to set
         */
        function ManifestRowPointer(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ManifestRowPointer rowId.
         * @member {Uint8Array} rowId
         * @memberof database_blob.ManifestRowPointer
         * @instance
         */
        ManifestRowPointer.prototype.rowId = $util.newBuffer([]);

        /**
         * ManifestRowPointer blobIndex.
         * @member {number} blobIndex
         * @memberof database_blob.ManifestRowPointer
         * @instance
         */
        ManifestRowPointer.prototype.blobIndex = 0;

        /**
         * ManifestRowPointer segmentOffset.
         * @member {number|Long} segmentOffset
         * @memberof database_blob.ManifestRowPointer
         * @instance
         */
        ManifestRowPointer.prototype.segmentOffset = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * ManifestRowPointer rid.
         * @member {database_blob.IDatabaseBlobRowRid|null|undefined} rid
         * @memberof database_blob.ManifestRowPointer
         * @instance
         */
        ManifestRowPointer.prototype.rid = null;

        /**
         * ManifestRowPointer deleted.
         * @member {boolean} deleted
         * @memberof database_blob.ManifestRowPointer
         * @instance
         */
        ManifestRowPointer.prototype.deleted = false;

        /**
         * ManifestRowPointer document.
         * @member {database_blob.IManifestRowDocumentPointer|null|undefined} document
         * @memberof database_blob.ManifestRowPointer
         * @instance
         */
        ManifestRowPointer.prototype.document = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * ManifestRowPointer _document.
         * @member {"document"|undefined} _document
         * @memberof database_blob.ManifestRowPointer
         * @instance
         */
        Object.defineProperty(ManifestRowPointer.prototype, "_document", {
            get: $util.oneOfGetter($oneOfFields = ["document"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new ManifestRowPointer instance using the specified properties.
         * @function create
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {database_blob.IManifestRowPointer=} [properties] Properties to set
         * @returns {database_blob.ManifestRowPointer} ManifestRowPointer instance
         */
        ManifestRowPointer.create = function create(properties) {
            return new ManifestRowPointer(properties);
        };

        /**
         * Encodes the specified ManifestRowPointer message. Does not implicitly {@link database_blob.ManifestRowPointer.verify|verify} messages.
         * @function encode
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {database_blob.IManifestRowPointer} message ManifestRowPointer message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ManifestRowPointer.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.rowId != null && Object.hasOwnProperty.call(message, "rowId"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.rowId);
            if (message.blobIndex != null && Object.hasOwnProperty.call(message, "blobIndex"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.blobIndex);
            if (message.segmentOffset != null && Object.hasOwnProperty.call(message, "segmentOffset"))
                writer.uint32(/* id 3, wireType 0 =*/24).uint64(message.segmentOffset);
            if (message.rid != null && Object.hasOwnProperty.call(message, "rid"))
                $root.database_blob.DatabaseBlobRowRid.encode(message.rid, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.deleted != null && Object.hasOwnProperty.call(message, "deleted"))
                writer.uint32(/* id 5, wireType 0 =*/40).bool(message.deleted);
            if (message.document != null && Object.hasOwnProperty.call(message, "document"))
                $root.database_blob.ManifestRowDocumentPointer.encode(message.document, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified ManifestRowPointer message, length delimited. Does not implicitly {@link database_blob.ManifestRowPointer.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {database_blob.IManifestRowPointer} message ManifestRowPointer message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ManifestRowPointer.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a ManifestRowPointer message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.ManifestRowPointer} ManifestRowPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ManifestRowPointer.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.ManifestRowPointer();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.rowId = reader.bytes();
                        break;
                    }
                case 2: {
                        message.blobIndex = reader.uint32();
                        break;
                    }
                case 3: {
                        message.segmentOffset = reader.uint64();
                        break;
                    }
                case 4: {
                        message.rid = $root.database_blob.DatabaseBlobRowRid.decode(reader, reader.uint32());
                        break;
                    }
                case 5: {
                        message.deleted = reader.bool();
                        break;
                    }
                case 6: {
                        message.document = $root.database_blob.ManifestRowDocumentPointer.decode(reader, reader.uint32());
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a ManifestRowPointer message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.ManifestRowPointer} ManifestRowPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ManifestRowPointer.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a ManifestRowPointer message.
         * @function verify
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ManifestRowPointer.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.rowId != null && message.hasOwnProperty("rowId"))
                if (!(message.rowId && typeof message.rowId.length === "number" || $util.isString(message.rowId)))
                    return "rowId: buffer expected";
            if (message.blobIndex != null && message.hasOwnProperty("blobIndex"))
                if (!$util.isInteger(message.blobIndex))
                    return "blobIndex: integer expected";
            if (message.segmentOffset != null && message.hasOwnProperty("segmentOffset"))
                if (!$util.isInteger(message.segmentOffset) && !(message.segmentOffset && $util.isInteger(message.segmentOffset.low) && $util.isInteger(message.segmentOffset.high)))
                    return "segmentOffset: integer|Long expected";
            if (message.rid != null && message.hasOwnProperty("rid")) {
                let error = $root.database_blob.DatabaseBlobRowRid.verify(message.rid);
                if (error)
                    return "rid." + error;
            }
            if (message.deleted != null && message.hasOwnProperty("deleted"))
                if (typeof message.deleted !== "boolean")
                    return "deleted: boolean expected";
            if (message.document != null && message.hasOwnProperty("document")) {
                properties._document = 1;
                {
                    let error = $root.database_blob.ManifestRowDocumentPointer.verify(message.document);
                    if (error)
                        return "document." + error;
                }
            }
            return null;
        };

        /**
         * Creates a ManifestRowPointer message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.ManifestRowPointer} ManifestRowPointer
         */
        ManifestRowPointer.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.ManifestRowPointer)
                return object;
            let message = new $root.database_blob.ManifestRowPointer();
            if (object.rowId != null)
                if (typeof object.rowId === "string")
                    $util.base64.decode(object.rowId, message.rowId = $util.newBuffer($util.base64.length(object.rowId)), 0);
                else if (object.rowId.length >= 0)
                    message.rowId = object.rowId;
            if (object.blobIndex != null)
                message.blobIndex = object.blobIndex >>> 0;
            if (object.segmentOffset != null)
                if ($util.Long)
                    (message.segmentOffset = $util.Long.fromValue(object.segmentOffset)).unsigned = true;
                else if (typeof object.segmentOffset === "string")
                    message.segmentOffset = parseInt(object.segmentOffset, 10);
                else if (typeof object.segmentOffset === "number")
                    message.segmentOffset = object.segmentOffset;
                else if (typeof object.segmentOffset === "object")
                    message.segmentOffset = new $util.LongBits(object.segmentOffset.low >>> 0, object.segmentOffset.high >>> 0).toNumber(true);
            if (object.rid != null) {
                if (typeof object.rid !== "object")
                    throw TypeError(".database_blob.ManifestRowPointer.rid: object expected");
                message.rid = $root.database_blob.DatabaseBlobRowRid.fromObject(object.rid);
            }
            if (object.deleted != null)
                message.deleted = Boolean(object.deleted);
            if (object.document != null) {
                if (typeof object.document !== "object")
                    throw TypeError(".database_blob.ManifestRowPointer.document: object expected");
                message.document = $root.database_blob.ManifestRowDocumentPointer.fromObject(object.document);
            }
            return message;
        };

        /**
         * Creates a plain object from a ManifestRowPointer message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {database_blob.ManifestRowPointer} message ManifestRowPointer
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ManifestRowPointer.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if (options.bytes === String)
                    object.rowId = "";
                else {
                    object.rowId = [];
                    if (options.bytes !== Array)
                        object.rowId = $util.newBuffer(object.rowId);
                }
                object.blobIndex = 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.segmentOffset = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.segmentOffset = options.longs === String ? "0" : 0;
                object.rid = null;
                object.deleted = false;
            }
            if (message.rowId != null && message.hasOwnProperty("rowId"))
                object.rowId = options.bytes === String ? $util.base64.encode(message.rowId, 0, message.rowId.length) : options.bytes === Array ? Array.prototype.slice.call(message.rowId) : message.rowId;
            if (message.blobIndex != null && message.hasOwnProperty("blobIndex"))
                object.blobIndex = message.blobIndex;
            if (message.segmentOffset != null && message.hasOwnProperty("segmentOffset"))
                if (typeof message.segmentOffset === "number")
                    object.segmentOffset = options.longs === String ? String(message.segmentOffset) : message.segmentOffset;
                else
                    object.segmentOffset = options.longs === String ? $util.Long.prototype.toString.call(message.segmentOffset) : options.longs === Number ? new $util.LongBits(message.segmentOffset.low >>> 0, message.segmentOffset.high >>> 0).toNumber(true) : message.segmentOffset;
            if (message.rid != null && message.hasOwnProperty("rid"))
                object.rid = $root.database_blob.DatabaseBlobRowRid.toObject(message.rid, options);
            if (message.deleted != null && message.hasOwnProperty("deleted"))
                object.deleted = message.deleted;
            if (message.document != null && message.hasOwnProperty("document")) {
                object.document = $root.database_blob.ManifestRowDocumentPointer.toObject(message.document, options);
                if (options.oneofs)
                    object._document = "document";
            }
            return object;
        };

        /**
         * Converts this ManifestRowPointer to JSON.
         * @function toJSON
         * @memberof database_blob.ManifestRowPointer
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ManifestRowPointer.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for ManifestRowPointer
         * @function getTypeUrl
         * @memberof database_blob.ManifestRowPointer
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        ManifestRowPointer.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.ManifestRowPointer";
        };

        return ManifestRowPointer;
    })();

    database_blob.DatabaseBlobManifest = (function() {

        /**
         * Properties of a DatabaseBlobManifest.
         * @memberof database_blob
         * @interface IDatabaseBlobManifest
         * @property {Uint8Array|null} [workspaceId] DatabaseBlobManifest workspaceId
         * @property {Uint8Array|null} [databaseId] DatabaseBlobManifest databaseId
         * @property {string|null} [versionId] DatabaseBlobManifest versionId
         * @property {Array.<database_blob.IBlobDescriptor>|null} [blobs] DatabaseBlobManifest blobs
         * @property {Array.<database_blob.IManifestRowPointer>|null} [rowIndex] DatabaseBlobManifest rowIndex
         * @property {number|Long|null} [updatedAtMillis] DatabaseBlobManifest updatedAtMillis
         * @property {number|Long|null} [lockEpoch] DatabaseBlobManifest lockEpoch
         */

        /**
         * Constructs a new DatabaseBlobManifest.
         * @memberof database_blob
         * @classdesc Represents a DatabaseBlobManifest.
         * @implements IDatabaseBlobManifest
         * @constructor
         * @param {database_blob.IDatabaseBlobManifest=} [properties] Properties to set
         */
        function DatabaseBlobManifest(properties) {
            this.blobs = [];
            this.rowIndex = [];
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * DatabaseBlobManifest workspaceId.
         * @member {Uint8Array} workspaceId
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         */
        DatabaseBlobManifest.prototype.workspaceId = $util.newBuffer([]);

        /**
         * DatabaseBlobManifest databaseId.
         * @member {Uint8Array} databaseId
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         */
        DatabaseBlobManifest.prototype.databaseId = $util.newBuffer([]);

        /**
         * DatabaseBlobManifest versionId.
         * @member {string} versionId
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         */
        DatabaseBlobManifest.prototype.versionId = "";

        /**
         * DatabaseBlobManifest blobs.
         * @member {Array.<database_blob.IBlobDescriptor>} blobs
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         */
        DatabaseBlobManifest.prototype.blobs = $util.emptyArray;

        /**
         * DatabaseBlobManifest rowIndex.
         * @member {Array.<database_blob.IManifestRowPointer>} rowIndex
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         */
        DatabaseBlobManifest.prototype.rowIndex = $util.emptyArray;

        /**
         * DatabaseBlobManifest updatedAtMillis.
         * @member {number|Long} updatedAtMillis
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         */
        DatabaseBlobManifest.prototype.updatedAtMillis = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * DatabaseBlobManifest lockEpoch.
         * @member {number|Long} lockEpoch
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         */
        DatabaseBlobManifest.prototype.lockEpoch = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Creates a new DatabaseBlobManifest instance using the specified properties.
         * @function create
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {database_blob.IDatabaseBlobManifest=} [properties] Properties to set
         * @returns {database_blob.DatabaseBlobManifest} DatabaseBlobManifest instance
         */
        DatabaseBlobManifest.create = function create(properties) {
            return new DatabaseBlobManifest(properties);
        };

        /**
         * Encodes the specified DatabaseBlobManifest message. Does not implicitly {@link database_blob.DatabaseBlobManifest.verify|verify} messages.
         * @function encode
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {database_blob.IDatabaseBlobManifest} message DatabaseBlobManifest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobManifest.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.workspaceId != null && Object.hasOwnProperty.call(message, "workspaceId"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.workspaceId);
            if (message.databaseId != null && Object.hasOwnProperty.call(message, "databaseId"))
                writer.uint32(/* id 2, wireType 2 =*/18).bytes(message.databaseId);
            if (message.versionId != null && Object.hasOwnProperty.call(message, "versionId"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.versionId);
            if (message.blobs != null && message.blobs.length)
                for (let i = 0; i < message.blobs.length; ++i)
                    $root.database_blob.BlobDescriptor.encode(message.blobs[i], writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.rowIndex != null && message.rowIndex.length)
                for (let i = 0; i < message.rowIndex.length; ++i)
                    $root.database_blob.ManifestRowPointer.encode(message.rowIndex[i], writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            if (message.updatedAtMillis != null && Object.hasOwnProperty.call(message, "updatedAtMillis"))
                writer.uint32(/* id 6, wireType 0 =*/48).int64(message.updatedAtMillis);
            if (message.lockEpoch != null && Object.hasOwnProperty.call(message, "lockEpoch"))
                writer.uint32(/* id 7, wireType 0 =*/56).uint64(message.lockEpoch);
            return writer;
        };

        /**
         * Encodes the specified DatabaseBlobManifest message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobManifest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {database_blob.IDatabaseBlobManifest} message DatabaseBlobManifest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        DatabaseBlobManifest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a DatabaseBlobManifest message from the specified reader or buffer.
         * @function decode
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {database_blob.DatabaseBlobManifest} DatabaseBlobManifest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobManifest.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.database_blob.DatabaseBlobManifest();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.workspaceId = reader.bytes();
                        break;
                    }
                case 2: {
                        message.databaseId = reader.bytes();
                        break;
                    }
                case 3: {
                        message.versionId = reader.string();
                        break;
                    }
                case 4: {
                        if (!(message.blobs && message.blobs.length))
                            message.blobs = [];
                        message.blobs.push($root.database_blob.BlobDescriptor.decode(reader, reader.uint32()));
                        break;
                    }
                case 5: {
                        if (!(message.rowIndex && message.rowIndex.length))
                            message.rowIndex = [];
                        message.rowIndex.push($root.database_blob.ManifestRowPointer.decode(reader, reader.uint32()));
                        break;
                    }
                case 6: {
                        message.updatedAtMillis = reader.int64();
                        break;
                    }
                case 7: {
                        message.lockEpoch = reader.uint64();
                        break;
                    }
                default:
                    reader.skipType(tag & 7);
                    break;
                }
            }
            return message;
        };

        /**
         * Decodes a DatabaseBlobManifest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {database_blob.DatabaseBlobManifest} DatabaseBlobManifest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        DatabaseBlobManifest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a DatabaseBlobManifest message.
         * @function verify
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        DatabaseBlobManifest.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.workspaceId != null && message.hasOwnProperty("workspaceId"))
                if (!(message.workspaceId && typeof message.workspaceId.length === "number" || $util.isString(message.workspaceId)))
                    return "workspaceId: buffer expected";
            if (message.databaseId != null && message.hasOwnProperty("databaseId"))
                if (!(message.databaseId && typeof message.databaseId.length === "number" || $util.isString(message.databaseId)))
                    return "databaseId: buffer expected";
            if (message.versionId != null && message.hasOwnProperty("versionId"))
                if (!$util.isString(message.versionId))
                    return "versionId: string expected";
            if (message.blobs != null && message.hasOwnProperty("blobs")) {
                if (!Array.isArray(message.blobs))
                    return "blobs: array expected";
                for (let i = 0; i < message.blobs.length; ++i) {
                    let error = $root.database_blob.BlobDescriptor.verify(message.blobs[i]);
                    if (error)
                        return "blobs." + error;
                }
            }
            if (message.rowIndex != null && message.hasOwnProperty("rowIndex")) {
                if (!Array.isArray(message.rowIndex))
                    return "rowIndex: array expected";
                for (let i = 0; i < message.rowIndex.length; ++i) {
                    let error = $root.database_blob.ManifestRowPointer.verify(message.rowIndex[i]);
                    if (error)
                        return "rowIndex." + error;
                }
            }
            if (message.updatedAtMillis != null && message.hasOwnProperty("updatedAtMillis"))
                if (!$util.isInteger(message.updatedAtMillis) && !(message.updatedAtMillis && $util.isInteger(message.updatedAtMillis.low) && $util.isInteger(message.updatedAtMillis.high)))
                    return "updatedAtMillis: integer|Long expected";
            if (message.lockEpoch != null && message.hasOwnProperty("lockEpoch"))
                if (!$util.isInteger(message.lockEpoch) && !(message.lockEpoch && $util.isInteger(message.lockEpoch.low) && $util.isInteger(message.lockEpoch.high)))
                    return "lockEpoch: integer|Long expected";
            return null;
        };

        /**
         * Creates a DatabaseBlobManifest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {database_blob.DatabaseBlobManifest} DatabaseBlobManifest
         */
        DatabaseBlobManifest.fromObject = function fromObject(object) {
            if (object instanceof $root.database_blob.DatabaseBlobManifest)
                return object;
            let message = new $root.database_blob.DatabaseBlobManifest();
            if (object.workspaceId != null)
                if (typeof object.workspaceId === "string")
                    $util.base64.decode(object.workspaceId, message.workspaceId = $util.newBuffer($util.base64.length(object.workspaceId)), 0);
                else if (object.workspaceId.length >= 0)
                    message.workspaceId = object.workspaceId;
            if (object.databaseId != null)
                if (typeof object.databaseId === "string")
                    $util.base64.decode(object.databaseId, message.databaseId = $util.newBuffer($util.base64.length(object.databaseId)), 0);
                else if (object.databaseId.length >= 0)
                    message.databaseId = object.databaseId;
            if (object.versionId != null)
                message.versionId = String(object.versionId);
            if (object.blobs) {
                if (!Array.isArray(object.blobs))
                    throw TypeError(".database_blob.DatabaseBlobManifest.blobs: array expected");
                message.blobs = [];
                for (let i = 0; i < object.blobs.length; ++i) {
                    if (typeof object.blobs[i] !== "object")
                        throw TypeError(".database_blob.DatabaseBlobManifest.blobs: object expected");
                    message.blobs[i] = $root.database_blob.BlobDescriptor.fromObject(object.blobs[i]);
                }
            }
            if (object.rowIndex) {
                if (!Array.isArray(object.rowIndex))
                    throw TypeError(".database_blob.DatabaseBlobManifest.rowIndex: array expected");
                message.rowIndex = [];
                for (let i = 0; i < object.rowIndex.length; ++i) {
                    if (typeof object.rowIndex[i] !== "object")
                        throw TypeError(".database_blob.DatabaseBlobManifest.rowIndex: object expected");
                    message.rowIndex[i] = $root.database_blob.ManifestRowPointer.fromObject(object.rowIndex[i]);
                }
            }
            if (object.updatedAtMillis != null)
                if ($util.Long)
                    (message.updatedAtMillis = $util.Long.fromValue(object.updatedAtMillis)).unsigned = false;
                else if (typeof object.updatedAtMillis === "string")
                    message.updatedAtMillis = parseInt(object.updatedAtMillis, 10);
                else if (typeof object.updatedAtMillis === "number")
                    message.updatedAtMillis = object.updatedAtMillis;
                else if (typeof object.updatedAtMillis === "object")
                    message.updatedAtMillis = new $util.LongBits(object.updatedAtMillis.low >>> 0, object.updatedAtMillis.high >>> 0).toNumber();
            if (object.lockEpoch != null)
                if ($util.Long)
                    (message.lockEpoch = $util.Long.fromValue(object.lockEpoch)).unsigned = true;
                else if (typeof object.lockEpoch === "string")
                    message.lockEpoch = parseInt(object.lockEpoch, 10);
                else if (typeof object.lockEpoch === "number")
                    message.lockEpoch = object.lockEpoch;
                else if (typeof object.lockEpoch === "object")
                    message.lockEpoch = new $util.LongBits(object.lockEpoch.low >>> 0, object.lockEpoch.high >>> 0).toNumber(true);
            return message;
        };

        /**
         * Creates a plain object from a DatabaseBlobManifest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {database_blob.DatabaseBlobManifest} message DatabaseBlobManifest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        DatabaseBlobManifest.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.arrays || options.defaults) {
                object.blobs = [];
                object.rowIndex = [];
            }
            if (options.defaults) {
                if (options.bytes === String)
                    object.workspaceId = "";
                else {
                    object.workspaceId = [];
                    if (options.bytes !== Array)
                        object.workspaceId = $util.newBuffer(object.workspaceId);
                }
                if (options.bytes === String)
                    object.databaseId = "";
                else {
                    object.databaseId = [];
                    if (options.bytes !== Array)
                        object.databaseId = $util.newBuffer(object.databaseId);
                }
                object.versionId = "";
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.updatedAtMillis = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.updatedAtMillis = options.longs === String ? "0" : 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.lockEpoch = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.lockEpoch = options.longs === String ? "0" : 0;
            }
            if (message.workspaceId != null && message.hasOwnProperty("workspaceId"))
                object.workspaceId = options.bytes === String ? $util.base64.encode(message.workspaceId, 0, message.workspaceId.length) : options.bytes === Array ? Array.prototype.slice.call(message.workspaceId) : message.workspaceId;
            if (message.databaseId != null && message.hasOwnProperty("databaseId"))
                object.databaseId = options.bytes === String ? $util.base64.encode(message.databaseId, 0, message.databaseId.length) : options.bytes === Array ? Array.prototype.slice.call(message.databaseId) : message.databaseId;
            if (message.versionId != null && message.hasOwnProperty("versionId"))
                object.versionId = message.versionId;
            if (message.blobs && message.blobs.length) {
                object.blobs = [];
                for (let j = 0; j < message.blobs.length; ++j)
                    object.blobs[j] = $root.database_blob.BlobDescriptor.toObject(message.blobs[j], options);
            }
            if (message.rowIndex && message.rowIndex.length) {
                object.rowIndex = [];
                for (let j = 0; j < message.rowIndex.length; ++j)
                    object.rowIndex[j] = $root.database_blob.ManifestRowPointer.toObject(message.rowIndex[j], options);
            }
            if (message.updatedAtMillis != null && message.hasOwnProperty("updatedAtMillis"))
                if (typeof message.updatedAtMillis === "number")
                    object.updatedAtMillis = options.longs === String ? String(message.updatedAtMillis) : message.updatedAtMillis;
                else
                    object.updatedAtMillis = options.longs === String ? $util.Long.prototype.toString.call(message.updatedAtMillis) : options.longs === Number ? new $util.LongBits(message.updatedAtMillis.low >>> 0, message.updatedAtMillis.high >>> 0).toNumber() : message.updatedAtMillis;
            if (message.lockEpoch != null && message.hasOwnProperty("lockEpoch"))
                if (typeof message.lockEpoch === "number")
                    object.lockEpoch = options.longs === String ? String(message.lockEpoch) : message.lockEpoch;
                else
                    object.lockEpoch = options.longs === String ? $util.Long.prototype.toString.call(message.lockEpoch) : options.longs === Number ? new $util.LongBits(message.lockEpoch.low >>> 0, message.lockEpoch.high >>> 0).toNumber(true) : message.lockEpoch;
            return object;
        };

        /**
         * Converts this DatabaseBlobManifest to JSON.
         * @function toJSON
         * @memberof database_blob.DatabaseBlobManifest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        DatabaseBlobManifest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for DatabaseBlobManifest
         * @function getTypeUrl
         * @memberof database_blob.DatabaseBlobManifest
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        DatabaseBlobManifest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/database_blob.DatabaseBlobManifest";
        };

        return DatabaseBlobManifest;
    })();

    /**
     * DiffStatus enum.
     * @name database_blob.DiffStatus
     * @enum {number}
     * @property {number} READY=0 READY value
     * @property {number} PENDING=1 PENDING value
     */
    database_blob.DiffStatus = (function() {
        const valuesById = {}, values = Object.create(valuesById);
        values[valuesById[0] = "READY"] = 0;
        values[valuesById[1] = "PENDING"] = 1;
        return values;
    })();

    return database_blob;
})();

export { $root as default };
