/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const messages = $root.messages = (() => {

    /**
     * Namespace messages.
     * @exports messages
     * @namespace
     */
    const messages = {};

    messages.Message = (function() {

        /**
         * Properties of a Message.
         * @memberof messages
         * @interface IMessage
         * @property {collab.ICollabMessage|null} [collabMessage] Message collabMessage
         * @property {notification.IWorkspaceNotification|null} [notification] Message notification
         */

        /**
         * Constructs a new Message.
         * @memberof messages
         * @classdesc All messages send between client/server are wrapped into a `Message`.
         * @implements IMessage
         * @constructor
         * @param {messages.IMessage=} [properties] Properties to set
         */
        function Message(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Message collabMessage.
         * @member {collab.ICollabMessage|null|undefined} collabMessage
         * @memberof messages.Message
         * @instance
         */
        Message.prototype.collabMessage = null;

        /**
         * Message notification.
         * @member {notification.IWorkspaceNotification|null|undefined} notification
         * @memberof messages.Message
         * @instance
         */
        Message.prototype.notification = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * Message payload.
         * @member {"collabMessage"|"notification"|undefined} payload
         * @memberof messages.Message
         * @instance
         */
        Object.defineProperty(Message.prototype, "payload", {
            get: $util.oneOfGetter($oneOfFields = ["collabMessage", "notification"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new Message instance using the specified properties.
         * @function create
         * @memberof messages.Message
         * @static
         * @param {messages.IMessage=} [properties] Properties to set
         * @returns {messages.Message} Message instance
         */
        Message.create = function create(properties) {
            return new Message(properties);
        };

        /**
         * Encodes the specified Message message. Does not implicitly {@link messages.Message.verify|verify} messages.
         * @function encode
         * @memberof messages.Message
         * @static
         * @param {messages.IMessage} message Message message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Message.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.collabMessage != null && Object.hasOwnProperty.call(message, "collabMessage"))
                $root.collab.CollabMessage.encode(message.collabMessage, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            if (message.notification != null && Object.hasOwnProperty.call(message, "notification"))
                $root.notification.WorkspaceNotification.encode(message.notification, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified Message message, length delimited. Does not implicitly {@link messages.Message.verify|verify} messages.
         * @function encodeDelimited
         * @memberof messages.Message
         * @static
         * @param {messages.IMessage} message Message message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Message.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Message message from the specified reader or buffer.
         * @function decode
         * @memberof messages.Message
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {messages.Message} Message
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Message.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.messages.Message();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.collabMessage = $root.collab.CollabMessage.decode(reader, reader.uint32());
                        break;
                    }
                case 2: {
                        message.notification = $root.notification.WorkspaceNotification.decode(reader, reader.uint32());
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
         * Decodes a Message message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof messages.Message
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {messages.Message} Message
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Message.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Message message.
         * @function verify
         * @memberof messages.Message
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Message.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.collabMessage != null && message.hasOwnProperty("collabMessage")) {
                properties.payload = 1;
                {
                    let error = $root.collab.CollabMessage.verify(message.collabMessage);
                    if (error)
                        return "collabMessage." + error;
                }
            }
            if (message.notification != null && message.hasOwnProperty("notification")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.WorkspaceNotification.verify(message.notification);
                    if (error)
                        return "notification." + error;
                }
            }
            return null;
        };

        /**
         * Creates a Message message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof messages.Message
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {messages.Message} Message
         */
        Message.fromObject = function fromObject(object) {
            if (object instanceof $root.messages.Message)
                return object;
            let message = new $root.messages.Message();
            if (object.collabMessage != null) {
                if (typeof object.collabMessage !== "object")
                    throw TypeError(".messages.Message.collabMessage: object expected");
                message.collabMessage = $root.collab.CollabMessage.fromObject(object.collabMessage);
            }
            if (object.notification != null) {
                if (typeof object.notification !== "object")
                    throw TypeError(".messages.Message.notification: object expected");
                message.notification = $root.notification.WorkspaceNotification.fromObject(object.notification);
            }
            return message;
        };

        /**
         * Creates a plain object from a Message message. Also converts values to other types if specified.
         * @function toObject
         * @memberof messages.Message
         * @static
         * @param {messages.Message} message Message
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Message.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (message.collabMessage != null && message.hasOwnProperty("collabMessage")) {
                object.collabMessage = $root.collab.CollabMessage.toObject(message.collabMessage, options);
                if (options.oneofs)
                    object.payload = "collabMessage";
            }
            if (message.notification != null && message.hasOwnProperty("notification")) {
                object.notification = $root.notification.WorkspaceNotification.toObject(message.notification, options);
                if (options.oneofs)
                    object.payload = "notification";
            }
            return object;
        };

        /**
         * Converts this Message to JSON.
         * @function toJSON
         * @memberof messages.Message
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Message.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Message
         * @function getTypeUrl
         * @memberof messages.Message
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Message.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/messages.Message";
        };

        return Message;
    })();

    return messages;
})();

export const collab = $root.collab = (() => {

    /**
     * Namespace collab.
     * @exports collab
     * @namespace
     */
    const collab = {};

    collab.Rid = (function() {

        /**
         * Properties of a Rid.
         * @memberof collab
         * @interface IRid
         * @property {number|Long|null} [timestamp] Rid timestamp
         * @property {number|null} [counter] Rid counter
         */

        /**
         * Constructs a new Rid.
         * @memberof collab
         * @classdesc Rid represents Redis stream message Id, which is a unique identifier
         * in scope of individual Redis stream - here workspace scope - assigned
         * to each update stored in Redis.
         * 
         * Default: "0-0"
         * @implements IRid
         * @constructor
         * @param {collab.IRid=} [properties] Properties to set
         */
        function Rid(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Rid timestamp.
         * @member {number|Long} timestamp
         * @memberof collab.Rid
         * @instance
         */
        Rid.prototype.timestamp = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * Rid counter.
         * @member {number} counter
         * @memberof collab.Rid
         * @instance
         */
        Rid.prototype.counter = 0;

        /**
         * Creates a new Rid instance using the specified properties.
         * @function create
         * @memberof collab.Rid
         * @static
         * @param {collab.IRid=} [properties] Properties to set
         * @returns {collab.Rid} Rid instance
         */
        Rid.create = function create(properties) {
            return new Rid(properties);
        };

        /**
         * Encodes the specified Rid message. Does not implicitly {@link collab.Rid.verify|verify} messages.
         * @function encode
         * @memberof collab.Rid
         * @static
         * @param {collab.IRid} message Rid message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Rid.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.timestamp != null && Object.hasOwnProperty.call(message, "timestamp"))
                writer.uint32(/* id 1, wireType 1 =*/9).fixed64(message.timestamp);
            if (message.counter != null && Object.hasOwnProperty.call(message, "counter"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.counter);
            return writer;
        };

        /**
         * Encodes the specified Rid message, length delimited. Does not implicitly {@link collab.Rid.verify|verify} messages.
         * @function encodeDelimited
         * @memberof collab.Rid
         * @static
         * @param {collab.IRid} message Rid message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Rid.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a Rid message from the specified reader or buffer.
         * @function decode
         * @memberof collab.Rid
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {collab.Rid} Rid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Rid.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.collab.Rid();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.timestamp = reader.fixed64();
                        break;
                    }
                case 2: {
                        message.counter = reader.uint32();
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
         * Decodes a Rid message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof collab.Rid
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {collab.Rid} Rid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Rid.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a Rid message.
         * @function verify
         * @memberof collab.Rid
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Rid.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.timestamp != null && message.hasOwnProperty("timestamp"))
                if (!$util.isInteger(message.timestamp) && !(message.timestamp && $util.isInteger(message.timestamp.low) && $util.isInteger(message.timestamp.high)))
                    return "timestamp: integer|Long expected";
            if (message.counter != null && message.hasOwnProperty("counter"))
                if (!$util.isInteger(message.counter))
                    return "counter: integer expected";
            return null;
        };

        /**
         * Creates a Rid message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof collab.Rid
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {collab.Rid} Rid
         */
        Rid.fromObject = function fromObject(object) {
            if (object instanceof $root.collab.Rid)
                return object;
            let message = new $root.collab.Rid();
            if (object.timestamp != null)
                if ($util.Long)
                    (message.timestamp = $util.Long.fromValue(object.timestamp)).unsigned = false;
                else if (typeof object.timestamp === "string")
                    message.timestamp = parseInt(object.timestamp, 10);
                else if (typeof object.timestamp === "number")
                    message.timestamp = object.timestamp;
                else if (typeof object.timestamp === "object")
                    message.timestamp = new $util.LongBits(object.timestamp.low >>> 0, object.timestamp.high >>> 0).toNumber();
            if (object.counter != null)
                message.counter = object.counter >>> 0;
            return message;
        };

        /**
         * Creates a plain object from a Rid message. Also converts values to other types if specified.
         * @function toObject
         * @memberof collab.Rid
         * @static
         * @param {collab.Rid} message Rid
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Rid.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.timestamp = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.timestamp = options.longs === String ? "0" : 0;
                object.counter = 0;
            }
            if (message.timestamp != null && message.hasOwnProperty("timestamp"))
                if (typeof message.timestamp === "number")
                    object.timestamp = options.longs === String ? String(message.timestamp) : message.timestamp;
                else
                    object.timestamp = options.longs === String ? $util.Long.prototype.toString.call(message.timestamp) : options.longs === Number ? new $util.LongBits(message.timestamp.low >>> 0, message.timestamp.high >>> 0).toNumber() : message.timestamp;
            if (message.counter != null && message.hasOwnProperty("counter"))
                object.counter = message.counter;
            return object;
        };

        /**
         * Converts this Rid to JSON.
         * @function toJSON
         * @memberof collab.Rid
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Rid.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Rid
         * @function getTypeUrl
         * @memberof collab.Rid
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Rid.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/collab.Rid";
        };

        return Rid;
    })();

    collab.SyncRequest = (function() {

        /**
         * Properties of a SyncRequest.
         * @memberof collab
         * @interface ISyncRequest
         * @property {collab.IRid|null} [lastMessageId] SyncRequest lastMessageId
         * @property {Uint8Array|null} [stateVector] SyncRequest stateVector
         */

        /**
         * Constructs a new SyncRequest.
         * @memberof collab
         * @classdesc SyncRequest message is send by either a server or a client, which informs about the
         * last collab state known to either party.
         * 
         * If other side has more recent data, it should send `Update` message in the response.
         * If other side has missing data, it should send its own `SyncRequest` in the response.
         * @implements ISyncRequest
         * @constructor
         * @param {collab.ISyncRequest=} [properties] Properties to set
         */
        function SyncRequest(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * SyncRequest lastMessageId.
         * @member {collab.IRid|null|undefined} lastMessageId
         * @memberof collab.SyncRequest
         * @instance
         */
        SyncRequest.prototype.lastMessageId = null;

        /**
         * SyncRequest stateVector.
         * @member {Uint8Array} stateVector
         * @memberof collab.SyncRequest
         * @instance
         */
        SyncRequest.prototype.stateVector = $util.newBuffer([]);

        /**
         * Creates a new SyncRequest instance using the specified properties.
         * @function create
         * @memberof collab.SyncRequest
         * @static
         * @param {collab.ISyncRequest=} [properties] Properties to set
         * @returns {collab.SyncRequest} SyncRequest instance
         */
        SyncRequest.create = function create(properties) {
            return new SyncRequest(properties);
        };

        /**
         * Encodes the specified SyncRequest message. Does not implicitly {@link collab.SyncRequest.verify|verify} messages.
         * @function encode
         * @memberof collab.SyncRequest
         * @static
         * @param {collab.ISyncRequest} message SyncRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        SyncRequest.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.lastMessageId != null && Object.hasOwnProperty.call(message, "lastMessageId"))
                $root.collab.Rid.encode(message.lastMessageId, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            if (message.stateVector != null && Object.hasOwnProperty.call(message, "stateVector"))
                writer.uint32(/* id 2, wireType 2 =*/18).bytes(message.stateVector);
            return writer;
        };

        /**
         * Encodes the specified SyncRequest message, length delimited. Does not implicitly {@link collab.SyncRequest.verify|verify} messages.
         * @function encodeDelimited
         * @memberof collab.SyncRequest
         * @static
         * @param {collab.ISyncRequest} message SyncRequest message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        SyncRequest.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a SyncRequest message from the specified reader or buffer.
         * @function decode
         * @memberof collab.SyncRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {collab.SyncRequest} SyncRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        SyncRequest.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.collab.SyncRequest();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.lastMessageId = $root.collab.Rid.decode(reader, reader.uint32());
                        break;
                    }
                case 2: {
                        message.stateVector = reader.bytes();
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
         * Decodes a SyncRequest message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof collab.SyncRequest
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {collab.SyncRequest} SyncRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        SyncRequest.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a SyncRequest message.
         * @function verify
         * @memberof collab.SyncRequest
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        SyncRequest.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.lastMessageId != null && message.hasOwnProperty("lastMessageId")) {
                let error = $root.collab.Rid.verify(message.lastMessageId);
                if (error)
                    return "lastMessageId." + error;
            }
            if (message.stateVector != null && message.hasOwnProperty("stateVector"))
                if (!(message.stateVector && typeof message.stateVector.length === "number" || $util.isString(message.stateVector)))
                    return "stateVector: buffer expected";
            return null;
        };

        /**
         * Creates a SyncRequest message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof collab.SyncRequest
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {collab.SyncRequest} SyncRequest
         */
        SyncRequest.fromObject = function fromObject(object) {
            if (object instanceof $root.collab.SyncRequest)
                return object;
            let message = new $root.collab.SyncRequest();
            if (object.lastMessageId != null) {
                if (typeof object.lastMessageId !== "object")
                    throw TypeError(".collab.SyncRequest.lastMessageId: object expected");
                message.lastMessageId = $root.collab.Rid.fromObject(object.lastMessageId);
            }
            if (object.stateVector != null)
                if (typeof object.stateVector === "string")
                    $util.base64.decode(object.stateVector, message.stateVector = $util.newBuffer($util.base64.length(object.stateVector)), 0);
                else if (object.stateVector.length >= 0)
                    message.stateVector = object.stateVector;
            return message;
        };

        /**
         * Creates a plain object from a SyncRequest message. Also converts values to other types if specified.
         * @function toObject
         * @memberof collab.SyncRequest
         * @static
         * @param {collab.SyncRequest} message SyncRequest
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        SyncRequest.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.lastMessageId = null;
                if (options.bytes === String)
                    object.stateVector = "";
                else {
                    object.stateVector = [];
                    if (options.bytes !== Array)
                        object.stateVector = $util.newBuffer(object.stateVector);
                }
            }
            if (message.lastMessageId != null && message.hasOwnProperty("lastMessageId"))
                object.lastMessageId = $root.collab.Rid.toObject(message.lastMessageId, options);
            if (message.stateVector != null && message.hasOwnProperty("stateVector"))
                object.stateVector = options.bytes === String ? $util.base64.encode(message.stateVector, 0, message.stateVector.length) : options.bytes === Array ? Array.prototype.slice.call(message.stateVector) : message.stateVector;
            return object;
        };

        /**
         * Converts this SyncRequest to JSON.
         * @function toJSON
         * @memberof collab.SyncRequest
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        SyncRequest.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for SyncRequest
         * @function getTypeUrl
         * @memberof collab.SyncRequest
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        SyncRequest.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/collab.SyncRequest";
        };

        return SyncRequest;
    })();

    collab.Update = (function() {

        /**
         * Properties of an Update.
         * @memberof collab
         * @interface IUpdate
         * @property {collab.IRid|null} [messageId] Update messageId
         * @property {number|null} [flags] Update flags
         * @property {Uint8Array|null} [payload] Update payload
         */

        /**
         * Constructs a new Update.
         * @memberof collab
         * @classdesc Update message is send either in response to `SyncRequest` or independently by
         * the client/server. It contains the Yjs doc update that can represent incremental
         * changes made over corresponding collab, or full document state.
         * @implements IUpdate
         * @constructor
         * @param {collab.IUpdate=} [properties] Properties to set
         */
        function Update(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * Update messageId.
         * @member {collab.IRid|null|undefined} messageId
         * @memberof collab.Update
         * @instance
         */
        Update.prototype.messageId = null;

        /**
         * Update flags.
         * @member {number} flags
         * @memberof collab.Update
         * @instance
         */
        Update.prototype.flags = 0;

        /**
         * Update payload.
         * @member {Uint8Array} payload
         * @memberof collab.Update
         * @instance
         */
        Update.prototype.payload = $util.newBuffer([]);

        /**
         * Creates a new Update instance using the specified properties.
         * @function create
         * @memberof collab.Update
         * @static
         * @param {collab.IUpdate=} [properties] Properties to set
         * @returns {collab.Update} Update instance
         */
        Update.create = function create(properties) {
            return new Update(properties);
        };

        /**
         * Encodes the specified Update message. Does not implicitly {@link collab.Update.verify|verify} messages.
         * @function encode
         * @memberof collab.Update
         * @static
         * @param {collab.IUpdate} message Update message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Update.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.messageId != null && Object.hasOwnProperty.call(message, "messageId"))
                $root.collab.Rid.encode(message.messageId, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            if (message.flags != null && Object.hasOwnProperty.call(message, "flags"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.flags);
            if (message.payload != null && Object.hasOwnProperty.call(message, "payload"))
                writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.payload);
            return writer;
        };

        /**
         * Encodes the specified Update message, length delimited. Does not implicitly {@link collab.Update.verify|verify} messages.
         * @function encodeDelimited
         * @memberof collab.Update
         * @static
         * @param {collab.IUpdate} message Update message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        Update.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an Update message from the specified reader or buffer.
         * @function decode
         * @memberof collab.Update
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {collab.Update} Update
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Update.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.collab.Update();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.messageId = $root.collab.Rid.decode(reader, reader.uint32());
                        break;
                    }
                case 2: {
                        message.flags = reader.uint32();
                        break;
                    }
                case 3: {
                        message.payload = reader.bytes();
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
         * Decodes an Update message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof collab.Update
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {collab.Update} Update
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        Update.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an Update message.
         * @function verify
         * @memberof collab.Update
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        Update.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.messageId != null && message.hasOwnProperty("messageId")) {
                let error = $root.collab.Rid.verify(message.messageId);
                if (error)
                    return "messageId." + error;
            }
            if (message.flags != null && message.hasOwnProperty("flags"))
                if (!$util.isInteger(message.flags))
                    return "flags: integer expected";
            if (message.payload != null && message.hasOwnProperty("payload"))
                if (!(message.payload && typeof message.payload.length === "number" || $util.isString(message.payload)))
                    return "payload: buffer expected";
            return null;
        };

        /**
         * Creates an Update message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof collab.Update
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {collab.Update} Update
         */
        Update.fromObject = function fromObject(object) {
            if (object instanceof $root.collab.Update)
                return object;
            let message = new $root.collab.Update();
            if (object.messageId != null) {
                if (typeof object.messageId !== "object")
                    throw TypeError(".collab.Update.messageId: object expected");
                message.messageId = $root.collab.Rid.fromObject(object.messageId);
            }
            if (object.flags != null)
                message.flags = object.flags >>> 0;
            if (object.payload != null)
                if (typeof object.payload === "string")
                    $util.base64.decode(object.payload, message.payload = $util.newBuffer($util.base64.length(object.payload)), 0);
                else if (object.payload.length >= 0)
                    message.payload = object.payload;
            return message;
        };

        /**
         * Creates a plain object from an Update message. Also converts values to other types if specified.
         * @function toObject
         * @memberof collab.Update
         * @static
         * @param {collab.Update} message Update
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        Update.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.messageId = null;
                object.flags = 0;
                if (options.bytes === String)
                    object.payload = "";
                else {
                    object.payload = [];
                    if (options.bytes !== Array)
                        object.payload = $util.newBuffer(object.payload);
                }
            }
            if (message.messageId != null && message.hasOwnProperty("messageId"))
                object.messageId = $root.collab.Rid.toObject(message.messageId, options);
            if (message.flags != null && message.hasOwnProperty("flags"))
                object.flags = message.flags;
            if (message.payload != null && message.hasOwnProperty("payload"))
                object.payload = options.bytes === String ? $util.base64.encode(message.payload, 0, message.payload.length) : options.bytes === Array ? Array.prototype.slice.call(message.payload) : message.payload;
            return object;
        };

        /**
         * Converts this Update to JSON.
         * @function toJSON
         * @memberof collab.Update
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        Update.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for Update
         * @function getTypeUrl
         * @memberof collab.Update
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        Update.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/collab.Update";
        };

        return Update;
    })();

    collab.AwarenessUpdate = (function() {

        /**
         * Properties of an AwarenessUpdate.
         * @memberof collab
         * @interface IAwarenessUpdate
         * @property {Uint8Array|null} [payload] AwarenessUpdate payload
         */

        /**
         * Constructs a new AwarenessUpdate.
         * @memberof collab
         * @classdesc AwarenessUpdate message is send to inform about the latest changes in the
         * Yjs doc awareness state.
         * @implements IAwarenessUpdate
         * @constructor
         * @param {collab.IAwarenessUpdate=} [properties] Properties to set
         */
        function AwarenessUpdate(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * AwarenessUpdate payload.
         * @member {Uint8Array} payload
         * @memberof collab.AwarenessUpdate
         * @instance
         */
        AwarenessUpdate.prototype.payload = $util.newBuffer([]);

        /**
         * Creates a new AwarenessUpdate instance using the specified properties.
         * @function create
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {collab.IAwarenessUpdate=} [properties] Properties to set
         * @returns {collab.AwarenessUpdate} AwarenessUpdate instance
         */
        AwarenessUpdate.create = function create(properties) {
            return new AwarenessUpdate(properties);
        };

        /**
         * Encodes the specified AwarenessUpdate message. Does not implicitly {@link collab.AwarenessUpdate.verify|verify} messages.
         * @function encode
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {collab.IAwarenessUpdate} message AwarenessUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AwarenessUpdate.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.payload != null && Object.hasOwnProperty.call(message, "payload"))
                writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.payload);
            return writer;
        };

        /**
         * Encodes the specified AwarenessUpdate message, length delimited. Does not implicitly {@link collab.AwarenessUpdate.verify|verify} messages.
         * @function encodeDelimited
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {collab.IAwarenessUpdate} message AwarenessUpdate message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AwarenessUpdate.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an AwarenessUpdate message from the specified reader or buffer.
         * @function decode
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {collab.AwarenessUpdate} AwarenessUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AwarenessUpdate.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.collab.AwarenessUpdate();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.payload = reader.bytes();
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
         * Decodes an AwarenessUpdate message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {collab.AwarenessUpdate} AwarenessUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AwarenessUpdate.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an AwarenessUpdate message.
         * @function verify
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        AwarenessUpdate.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.payload != null && message.hasOwnProperty("payload"))
                if (!(message.payload && typeof message.payload.length === "number" || $util.isString(message.payload)))
                    return "payload: buffer expected";
            return null;
        };

        /**
         * Creates an AwarenessUpdate message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {collab.AwarenessUpdate} AwarenessUpdate
         */
        AwarenessUpdate.fromObject = function fromObject(object) {
            if (object instanceof $root.collab.AwarenessUpdate)
                return object;
            let message = new $root.collab.AwarenessUpdate();
            if (object.payload != null)
                if (typeof object.payload === "string")
                    $util.base64.decode(object.payload, message.payload = $util.newBuffer($util.base64.length(object.payload)), 0);
                else if (object.payload.length >= 0)
                    message.payload = object.payload;
            return message;
        };

        /**
         * Creates a plain object from an AwarenessUpdate message. Also converts values to other types if specified.
         * @function toObject
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {collab.AwarenessUpdate} message AwarenessUpdate
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        AwarenessUpdate.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                if (options.bytes === String)
                    object.payload = "";
                else {
                    object.payload = [];
                    if (options.bytes !== Array)
                        object.payload = $util.newBuffer(object.payload);
                }
            if (message.payload != null && message.hasOwnProperty("payload"))
                object.payload = options.bytes === String ? $util.base64.encode(message.payload, 0, message.payload.length) : options.bytes === Array ? Array.prototype.slice.call(message.payload) : message.payload;
            return object;
        };

        /**
         * Converts this AwarenessUpdate to JSON.
         * @function toJSON
         * @memberof collab.AwarenessUpdate
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        AwarenessUpdate.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for AwarenessUpdate
         * @function getTypeUrl
         * @memberof collab.AwarenessUpdate
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        AwarenessUpdate.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/collab.AwarenessUpdate";
        };

        return AwarenessUpdate;
    })();

    collab.AccessChanged = (function() {

        /**
         * Properties of an AccessChanged.
         * @memberof collab
         * @interface IAccessChanged
         * @property {boolean|null} [canRead] AccessChanged canRead
         * @property {boolean|null} [canWrite] AccessChanged canWrite
         * @property {number|null} [reason] AccessChanged reason
         */

        /**
         * Constructs a new AccessChanged.
         * @memberof collab
         * @classdesc AccessChanged message is sent only by the server when we recognise, that
         * connected client has lost the access to a corresponding collab.
         * @implements IAccessChanged
         * @constructor
         * @param {collab.IAccessChanged=} [properties] Properties to set
         */
        function AccessChanged(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * AccessChanged canRead.
         * @member {boolean} canRead
         * @memberof collab.AccessChanged
         * @instance
         */
        AccessChanged.prototype.canRead = false;

        /**
         * AccessChanged canWrite.
         * @member {boolean} canWrite
         * @memberof collab.AccessChanged
         * @instance
         */
        AccessChanged.prototype.canWrite = false;

        /**
         * AccessChanged reason.
         * @member {number} reason
         * @memberof collab.AccessChanged
         * @instance
         */
        AccessChanged.prototype.reason = 0;

        /**
         * Creates a new AccessChanged instance using the specified properties.
         * @function create
         * @memberof collab.AccessChanged
         * @static
         * @param {collab.IAccessChanged=} [properties] Properties to set
         * @returns {collab.AccessChanged} AccessChanged instance
         */
        AccessChanged.create = function create(properties) {
            return new AccessChanged(properties);
        };

        /**
         * Encodes the specified AccessChanged message. Does not implicitly {@link collab.AccessChanged.verify|verify} messages.
         * @function encode
         * @memberof collab.AccessChanged
         * @static
         * @param {collab.IAccessChanged} message AccessChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AccessChanged.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.canRead != null && Object.hasOwnProperty.call(message, "canRead"))
                writer.uint32(/* id 1, wireType 0 =*/8).bool(message.canRead);
            if (message.canWrite != null && Object.hasOwnProperty.call(message, "canWrite"))
                writer.uint32(/* id 2, wireType 0 =*/16).bool(message.canWrite);
            if (message.reason != null && Object.hasOwnProperty.call(message, "reason"))
                writer.uint32(/* id 3, wireType 0 =*/24).int32(message.reason);
            return writer;
        };

        /**
         * Encodes the specified AccessChanged message, length delimited. Does not implicitly {@link collab.AccessChanged.verify|verify} messages.
         * @function encodeDelimited
         * @memberof collab.AccessChanged
         * @static
         * @param {collab.IAccessChanged} message AccessChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        AccessChanged.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an AccessChanged message from the specified reader or buffer.
         * @function decode
         * @memberof collab.AccessChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {collab.AccessChanged} AccessChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AccessChanged.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.collab.AccessChanged();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.canRead = reader.bool();
                        break;
                    }
                case 2: {
                        message.canWrite = reader.bool();
                        break;
                    }
                case 3: {
                        message.reason = reader.int32();
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
         * Decodes an AccessChanged message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof collab.AccessChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {collab.AccessChanged} AccessChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        AccessChanged.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an AccessChanged message.
         * @function verify
         * @memberof collab.AccessChanged
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        AccessChanged.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.canRead != null && message.hasOwnProperty("canRead"))
                if (typeof message.canRead !== "boolean")
                    return "canRead: boolean expected";
            if (message.canWrite != null && message.hasOwnProperty("canWrite"))
                if (typeof message.canWrite !== "boolean")
                    return "canWrite: boolean expected";
            if (message.reason != null && message.hasOwnProperty("reason"))
                if (!$util.isInteger(message.reason))
                    return "reason: integer expected";
            return null;
        };

        /**
         * Creates an AccessChanged message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof collab.AccessChanged
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {collab.AccessChanged} AccessChanged
         */
        AccessChanged.fromObject = function fromObject(object) {
            if (object instanceof $root.collab.AccessChanged)
                return object;
            let message = new $root.collab.AccessChanged();
            if (object.canRead != null)
                message.canRead = Boolean(object.canRead);
            if (object.canWrite != null)
                message.canWrite = Boolean(object.canWrite);
            if (object.reason != null)
                message.reason = object.reason | 0;
            return message;
        };

        /**
         * Creates a plain object from an AccessChanged message. Also converts values to other types if specified.
         * @function toObject
         * @memberof collab.AccessChanged
         * @static
         * @param {collab.AccessChanged} message AccessChanged
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        AccessChanged.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.canRead = false;
                object.canWrite = false;
                object.reason = 0;
            }
            if (message.canRead != null && message.hasOwnProperty("canRead"))
                object.canRead = message.canRead;
            if (message.canWrite != null && message.hasOwnProperty("canWrite"))
                object.canWrite = message.canWrite;
            if (message.reason != null && message.hasOwnProperty("reason"))
                object.reason = message.reason;
            return object;
        };

        /**
         * Converts this AccessChanged to JSON.
         * @function toJSON
         * @memberof collab.AccessChanged
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        AccessChanged.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for AccessChanged
         * @function getTypeUrl
         * @memberof collab.AccessChanged
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        AccessChanged.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/collab.AccessChanged";
        };

        return AccessChanged;
    })();

    collab.CollabMessage = (function() {

        /**
         * Properties of a CollabMessage.
         * @memberof collab
         * @interface ICollabMessage
         * @property {string|null} [objectId] CollabMessage objectId
         * @property {number|null} [collabType] CollabMessage collabType
         * @property {collab.ISyncRequest|null} [syncRequest] CollabMessage syncRequest
         * @property {collab.IUpdate|null} [update] CollabMessage update
         * @property {collab.IAwarenessUpdate|null} [awarenessUpdate] CollabMessage awarenessUpdate
         * @property {collab.IAccessChanged|null} [accessChanged] CollabMessage accessChanged
         */

        /**
         * Constructs a new CollabMessage.
         * @memberof collab
         * @classdesc Represents a CollabMessage.
         * @implements ICollabMessage
         * @constructor
         * @param {collab.ICollabMessage=} [properties] Properties to set
         */
        function CollabMessage(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * CollabMessage objectId.
         * @member {string} objectId
         * @memberof collab.CollabMessage
         * @instance
         */
        CollabMessage.prototype.objectId = "";

        /**
         * CollabMessage collabType.
         * @member {number} collabType
         * @memberof collab.CollabMessage
         * @instance
         */
        CollabMessage.prototype.collabType = 0;

        /**
         * CollabMessage syncRequest.
         * @member {collab.ISyncRequest|null|undefined} syncRequest
         * @memberof collab.CollabMessage
         * @instance
         */
        CollabMessage.prototype.syncRequest = null;

        /**
         * CollabMessage update.
         * @member {collab.IUpdate|null|undefined} update
         * @memberof collab.CollabMessage
         * @instance
         */
        CollabMessage.prototype.update = null;

        /**
         * CollabMessage awarenessUpdate.
         * @member {collab.IAwarenessUpdate|null|undefined} awarenessUpdate
         * @memberof collab.CollabMessage
         * @instance
         */
        CollabMessage.prototype.awarenessUpdate = null;

        /**
         * CollabMessage accessChanged.
         * @member {collab.IAccessChanged|null|undefined} accessChanged
         * @memberof collab.CollabMessage
         * @instance
         */
        CollabMessage.prototype.accessChanged = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * CollabMessage data.
         * @member {"syncRequest"|"update"|"awarenessUpdate"|"accessChanged"|undefined} data
         * @memberof collab.CollabMessage
         * @instance
         */
        Object.defineProperty(CollabMessage.prototype, "data", {
            get: $util.oneOfGetter($oneOfFields = ["syncRequest", "update", "awarenessUpdate", "accessChanged"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new CollabMessage instance using the specified properties.
         * @function create
         * @memberof collab.CollabMessage
         * @static
         * @param {collab.ICollabMessage=} [properties] Properties to set
         * @returns {collab.CollabMessage} CollabMessage instance
         */
        CollabMessage.create = function create(properties) {
            return new CollabMessage(properties);
        };

        /**
         * Encodes the specified CollabMessage message. Does not implicitly {@link collab.CollabMessage.verify|verify} messages.
         * @function encode
         * @memberof collab.CollabMessage
         * @static
         * @param {collab.ICollabMessage} message CollabMessage message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CollabMessage.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.objectId != null && Object.hasOwnProperty.call(message, "objectId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.objectId);
            if (message.collabType != null && Object.hasOwnProperty.call(message, "collabType"))
                writer.uint32(/* id 2, wireType 0 =*/16).int32(message.collabType);
            if (message.syncRequest != null && Object.hasOwnProperty.call(message, "syncRequest"))
                $root.collab.SyncRequest.encode(message.syncRequest, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.update != null && Object.hasOwnProperty.call(message, "update"))
                $root.collab.Update.encode(message.update, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.awarenessUpdate != null && Object.hasOwnProperty.call(message, "awarenessUpdate"))
                $root.collab.AwarenessUpdate.encode(message.awarenessUpdate, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            if (message.accessChanged != null && Object.hasOwnProperty.call(message, "accessChanged"))
                $root.collab.AccessChanged.encode(message.accessChanged, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified CollabMessage message, length delimited. Does not implicitly {@link collab.CollabMessage.verify|verify} messages.
         * @function encodeDelimited
         * @memberof collab.CollabMessage
         * @static
         * @param {collab.ICollabMessage} message CollabMessage message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        CollabMessage.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a CollabMessage message from the specified reader or buffer.
         * @function decode
         * @memberof collab.CollabMessage
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {collab.CollabMessage} CollabMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CollabMessage.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.collab.CollabMessage();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.objectId = reader.string();
                        break;
                    }
                case 2: {
                        message.collabType = reader.int32();
                        break;
                    }
                case 3: {
                        message.syncRequest = $root.collab.SyncRequest.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.update = $root.collab.Update.decode(reader, reader.uint32());
                        break;
                    }
                case 5: {
                        message.awarenessUpdate = $root.collab.AwarenessUpdate.decode(reader, reader.uint32());
                        break;
                    }
                case 6: {
                        message.accessChanged = $root.collab.AccessChanged.decode(reader, reader.uint32());
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
         * Decodes a CollabMessage message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof collab.CollabMessage
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {collab.CollabMessage} CollabMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        CollabMessage.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a CollabMessage message.
         * @function verify
         * @memberof collab.CollabMessage
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        CollabMessage.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.objectId != null && message.hasOwnProperty("objectId"))
                if (!$util.isString(message.objectId))
                    return "objectId: string expected";
            if (message.collabType != null && message.hasOwnProperty("collabType"))
                if (!$util.isInteger(message.collabType))
                    return "collabType: integer expected";
            if (message.syncRequest != null && message.hasOwnProperty("syncRequest")) {
                properties.data = 1;
                {
                    let error = $root.collab.SyncRequest.verify(message.syncRequest);
                    if (error)
                        return "syncRequest." + error;
                }
            }
            if (message.update != null && message.hasOwnProperty("update")) {
                if (properties.data === 1)
                    return "data: multiple values";
                properties.data = 1;
                {
                    let error = $root.collab.Update.verify(message.update);
                    if (error)
                        return "update." + error;
                }
            }
            if (message.awarenessUpdate != null && message.hasOwnProperty("awarenessUpdate")) {
                if (properties.data === 1)
                    return "data: multiple values";
                properties.data = 1;
                {
                    let error = $root.collab.AwarenessUpdate.verify(message.awarenessUpdate);
                    if (error)
                        return "awarenessUpdate." + error;
                }
            }
            if (message.accessChanged != null && message.hasOwnProperty("accessChanged")) {
                if (properties.data === 1)
                    return "data: multiple values";
                properties.data = 1;
                {
                    let error = $root.collab.AccessChanged.verify(message.accessChanged);
                    if (error)
                        return "accessChanged." + error;
                }
            }
            return null;
        };

        /**
         * Creates a CollabMessage message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof collab.CollabMessage
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {collab.CollabMessage} CollabMessage
         */
        CollabMessage.fromObject = function fromObject(object) {
            if (object instanceof $root.collab.CollabMessage)
                return object;
            let message = new $root.collab.CollabMessage();
            if (object.objectId != null)
                message.objectId = String(object.objectId);
            if (object.collabType != null)
                message.collabType = object.collabType | 0;
            if (object.syncRequest != null) {
                if (typeof object.syncRequest !== "object")
                    throw TypeError(".collab.CollabMessage.syncRequest: object expected");
                message.syncRequest = $root.collab.SyncRequest.fromObject(object.syncRequest);
            }
            if (object.update != null) {
                if (typeof object.update !== "object")
                    throw TypeError(".collab.CollabMessage.update: object expected");
                message.update = $root.collab.Update.fromObject(object.update);
            }
            if (object.awarenessUpdate != null) {
                if (typeof object.awarenessUpdate !== "object")
                    throw TypeError(".collab.CollabMessage.awarenessUpdate: object expected");
                message.awarenessUpdate = $root.collab.AwarenessUpdate.fromObject(object.awarenessUpdate);
            }
            if (object.accessChanged != null) {
                if (typeof object.accessChanged !== "object")
                    throw TypeError(".collab.CollabMessage.accessChanged: object expected");
                message.accessChanged = $root.collab.AccessChanged.fromObject(object.accessChanged);
            }
            return message;
        };

        /**
         * Creates a plain object from a CollabMessage message. Also converts values to other types if specified.
         * @function toObject
         * @memberof collab.CollabMessage
         * @static
         * @param {collab.CollabMessage} message CollabMessage
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        CollabMessage.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.objectId = "";
                object.collabType = 0;
            }
            if (message.objectId != null && message.hasOwnProperty("objectId"))
                object.objectId = message.objectId;
            if (message.collabType != null && message.hasOwnProperty("collabType"))
                object.collabType = message.collabType;
            if (message.syncRequest != null && message.hasOwnProperty("syncRequest")) {
                object.syncRequest = $root.collab.SyncRequest.toObject(message.syncRequest, options);
                if (options.oneofs)
                    object.data = "syncRequest";
            }
            if (message.update != null && message.hasOwnProperty("update")) {
                object.update = $root.collab.Update.toObject(message.update, options);
                if (options.oneofs)
                    object.data = "update";
            }
            if (message.awarenessUpdate != null && message.hasOwnProperty("awarenessUpdate")) {
                object.awarenessUpdate = $root.collab.AwarenessUpdate.toObject(message.awarenessUpdate, options);
                if (options.oneofs)
                    object.data = "awarenessUpdate";
            }
            if (message.accessChanged != null && message.hasOwnProperty("accessChanged")) {
                object.accessChanged = $root.collab.AccessChanged.toObject(message.accessChanged, options);
                if (options.oneofs)
                    object.data = "accessChanged";
            }
            return object;
        };

        /**
         * Converts this CollabMessage to JSON.
         * @function toJSON
         * @memberof collab.CollabMessage
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        CollabMessage.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for CollabMessage
         * @function getTypeUrl
         * @memberof collab.CollabMessage
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        CollabMessage.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/collab.CollabMessage";
        };

        return CollabMessage;
    })();

    return collab;
})();

export const notification = $root.notification = (() => {

    /**
     * Namespace notification.
     * @exports notification
     * @namespace
     */
    const notification = {};

    notification.WorkspaceNotification = (function() {

        /**
         * Properties of a WorkspaceNotification.
         * @memberof notification
         * @interface IWorkspaceNotification
         * @property {notification.IUserProfileChange|null} [profileChange] WorkspaceNotification profileChange
         * @property {notification.IPermissionChanged|null} [permissionChanged] WorkspaceNotification permissionChanged
         * @property {notification.ISectionChanged|null} [sectionChanged] WorkspaceNotification sectionChanged
         * @property {notification.IShareViewsChanged|null} [shareViewsChanged] WorkspaceNotification shareViewsChanged
         * @property {notification.IMentionablePersonListChanged|null} [mentionablePersonListChanged] WorkspaceNotification mentionablePersonListChanged
         * @property {notification.IServerLimit|null} [serverLimit] WorkspaceNotification serverLimit
         * @property {notification.IWorkspaceMemberProfileChanged|null} [workspaceMemberProfileChanged] WorkspaceNotification workspaceMemberProfileChanged
         * @property {notification.IFolderChanged|null} [folderChanged] WorkspaceNotification folderChanged
         */

        /**
         * Constructs a new WorkspaceNotification.
         * @memberof notification
         * @classdesc Represents a WorkspaceNotification.
         * @implements IWorkspaceNotification
         * @constructor
         * @param {notification.IWorkspaceNotification=} [properties] Properties to set
         */
        function WorkspaceNotification(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * WorkspaceNotification profileChange.
         * @member {notification.IUserProfileChange|null|undefined} profileChange
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.profileChange = null;

        /**
         * WorkspaceNotification permissionChanged.
         * @member {notification.IPermissionChanged|null|undefined} permissionChanged
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.permissionChanged = null;

        /**
         * WorkspaceNotification sectionChanged.
         * @member {notification.ISectionChanged|null|undefined} sectionChanged
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.sectionChanged = null;

        /**
         * WorkspaceNotification shareViewsChanged.
         * @member {notification.IShareViewsChanged|null|undefined} shareViewsChanged
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.shareViewsChanged = null;

        /**
         * WorkspaceNotification mentionablePersonListChanged.
         * @member {notification.IMentionablePersonListChanged|null|undefined} mentionablePersonListChanged
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.mentionablePersonListChanged = null;

        /**
         * WorkspaceNotification serverLimit.
         * @member {notification.IServerLimit|null|undefined} serverLimit
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.serverLimit = null;

        /**
         * WorkspaceNotification workspaceMemberProfileChanged.
         * @member {notification.IWorkspaceMemberProfileChanged|null|undefined} workspaceMemberProfileChanged
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.workspaceMemberProfileChanged = null;

        /**
         * WorkspaceNotification folderChanged.
         * @member {notification.IFolderChanged|null|undefined} folderChanged
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        WorkspaceNotification.prototype.folderChanged = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * WorkspaceNotification payload.
         * @member {"profileChange"|"permissionChanged"|"sectionChanged"|"shareViewsChanged"|"mentionablePersonListChanged"|"serverLimit"|"workspaceMemberProfileChanged"|"folderChanged"|undefined} payload
         * @memberof notification.WorkspaceNotification
         * @instance
         */
        Object.defineProperty(WorkspaceNotification.prototype, "payload", {
            get: $util.oneOfGetter($oneOfFields = ["profileChange", "permissionChanged", "sectionChanged", "shareViewsChanged", "mentionablePersonListChanged", "serverLimit", "workspaceMemberProfileChanged", "folderChanged"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new WorkspaceNotification instance using the specified properties.
         * @function create
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {notification.IWorkspaceNotification=} [properties] Properties to set
         * @returns {notification.WorkspaceNotification} WorkspaceNotification instance
         */
        WorkspaceNotification.create = function create(properties) {
            return new WorkspaceNotification(properties);
        };

        /**
         * Encodes the specified WorkspaceNotification message. Does not implicitly {@link notification.WorkspaceNotification.verify|verify} messages.
         * @function encode
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {notification.IWorkspaceNotification} message WorkspaceNotification message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        WorkspaceNotification.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.profileChange != null && Object.hasOwnProperty.call(message, "profileChange"))
                $root.notification.UserProfileChange.encode(message.profileChange, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            if (message.permissionChanged != null && Object.hasOwnProperty.call(message, "permissionChanged"))
                $root.notification.PermissionChanged.encode(message.permissionChanged, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.sectionChanged != null && Object.hasOwnProperty.call(message, "sectionChanged"))
                $root.notification.SectionChanged.encode(message.sectionChanged, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.shareViewsChanged != null && Object.hasOwnProperty.call(message, "shareViewsChanged"))
                $root.notification.ShareViewsChanged.encode(message.shareViewsChanged, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            if (message.mentionablePersonListChanged != null && Object.hasOwnProperty.call(message, "mentionablePersonListChanged"))
                $root.notification.MentionablePersonListChanged.encode(message.mentionablePersonListChanged, writer.uint32(/* id 5, wireType 2 =*/42).fork()).ldelim();
            if (message.serverLimit != null && Object.hasOwnProperty.call(message, "serverLimit"))
                $root.notification.ServerLimit.encode(message.serverLimit, writer.uint32(/* id 6, wireType 2 =*/50).fork()).ldelim();
            if (message.workspaceMemberProfileChanged != null && Object.hasOwnProperty.call(message, "workspaceMemberProfileChanged"))
                $root.notification.WorkspaceMemberProfileChanged.encode(message.workspaceMemberProfileChanged, writer.uint32(/* id 7, wireType 2 =*/58).fork()).ldelim();
            if (message.folderChanged != null && Object.hasOwnProperty.call(message, "folderChanged"))
                $root.notification.FolderChanged.encode(message.folderChanged, writer.uint32(/* id 8, wireType 2 =*/66).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified WorkspaceNotification message, length delimited. Does not implicitly {@link notification.WorkspaceNotification.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {notification.IWorkspaceNotification} message WorkspaceNotification message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        WorkspaceNotification.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a WorkspaceNotification message from the specified reader or buffer.
         * @function decode
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.WorkspaceNotification} WorkspaceNotification
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        WorkspaceNotification.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.WorkspaceNotification();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.profileChange = $root.notification.UserProfileChange.decode(reader, reader.uint32());
                        break;
                    }
                case 2: {
                        message.permissionChanged = $root.notification.PermissionChanged.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.sectionChanged = $root.notification.SectionChanged.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.shareViewsChanged = $root.notification.ShareViewsChanged.decode(reader, reader.uint32());
                        break;
                    }
                case 5: {
                        message.mentionablePersonListChanged = $root.notification.MentionablePersonListChanged.decode(reader, reader.uint32());
                        break;
                    }
                case 6: {
                        message.serverLimit = $root.notification.ServerLimit.decode(reader, reader.uint32());
                        break;
                    }
                case 7: {
                        message.workspaceMemberProfileChanged = $root.notification.WorkspaceMemberProfileChanged.decode(reader, reader.uint32());
                        break;
                    }
                case 8: {
                        message.folderChanged = $root.notification.FolderChanged.decode(reader, reader.uint32());
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
         * Decodes a WorkspaceNotification message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.WorkspaceNotification} WorkspaceNotification
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        WorkspaceNotification.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a WorkspaceNotification message.
         * @function verify
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        WorkspaceNotification.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.profileChange != null && message.hasOwnProperty("profileChange")) {
                properties.payload = 1;
                {
                    let error = $root.notification.UserProfileChange.verify(message.profileChange);
                    if (error)
                        return "profileChange." + error;
                }
            }
            if (message.permissionChanged != null && message.hasOwnProperty("permissionChanged")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.PermissionChanged.verify(message.permissionChanged);
                    if (error)
                        return "permissionChanged." + error;
                }
            }
            if (message.sectionChanged != null && message.hasOwnProperty("sectionChanged")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.SectionChanged.verify(message.sectionChanged);
                    if (error)
                        return "sectionChanged." + error;
                }
            }
            if (message.shareViewsChanged != null && message.hasOwnProperty("shareViewsChanged")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.ShareViewsChanged.verify(message.shareViewsChanged);
                    if (error)
                        return "shareViewsChanged." + error;
                }
            }
            if (message.mentionablePersonListChanged != null && message.hasOwnProperty("mentionablePersonListChanged")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.MentionablePersonListChanged.verify(message.mentionablePersonListChanged);
                    if (error)
                        return "mentionablePersonListChanged." + error;
                }
            }
            if (message.serverLimit != null && message.hasOwnProperty("serverLimit")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.ServerLimit.verify(message.serverLimit);
                    if (error)
                        return "serverLimit." + error;
                }
            }
            if (message.workspaceMemberProfileChanged != null && message.hasOwnProperty("workspaceMemberProfileChanged")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.WorkspaceMemberProfileChanged.verify(message.workspaceMemberProfileChanged);
                    if (error)
                        return "workspaceMemberProfileChanged." + error;
                }
            }
            if (message.folderChanged != null && message.hasOwnProperty("folderChanged")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.FolderChanged.verify(message.folderChanged);
                    if (error)
                        return "folderChanged." + error;
                }
            }
            return null;
        };

        /**
         * Creates a WorkspaceNotification message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.WorkspaceNotification} WorkspaceNotification
         */
        WorkspaceNotification.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.WorkspaceNotification)
                return object;
            let message = new $root.notification.WorkspaceNotification();
            if (object.profileChange != null) {
                if (typeof object.profileChange !== "object")
                    throw TypeError(".notification.WorkspaceNotification.profileChange: object expected");
                message.profileChange = $root.notification.UserProfileChange.fromObject(object.profileChange);
            }
            if (object.permissionChanged != null) {
                if (typeof object.permissionChanged !== "object")
                    throw TypeError(".notification.WorkspaceNotification.permissionChanged: object expected");
                message.permissionChanged = $root.notification.PermissionChanged.fromObject(object.permissionChanged);
            }
            if (object.sectionChanged != null) {
                if (typeof object.sectionChanged !== "object")
                    throw TypeError(".notification.WorkspaceNotification.sectionChanged: object expected");
                message.sectionChanged = $root.notification.SectionChanged.fromObject(object.sectionChanged);
            }
            if (object.shareViewsChanged != null) {
                if (typeof object.shareViewsChanged !== "object")
                    throw TypeError(".notification.WorkspaceNotification.shareViewsChanged: object expected");
                message.shareViewsChanged = $root.notification.ShareViewsChanged.fromObject(object.shareViewsChanged);
            }
            if (object.mentionablePersonListChanged != null) {
                if (typeof object.mentionablePersonListChanged !== "object")
                    throw TypeError(".notification.WorkspaceNotification.mentionablePersonListChanged: object expected");
                message.mentionablePersonListChanged = $root.notification.MentionablePersonListChanged.fromObject(object.mentionablePersonListChanged);
            }
            if (object.serverLimit != null) {
                if (typeof object.serverLimit !== "object")
                    throw TypeError(".notification.WorkspaceNotification.serverLimit: object expected");
                message.serverLimit = $root.notification.ServerLimit.fromObject(object.serverLimit);
            }
            if (object.workspaceMemberProfileChanged != null) {
                if (typeof object.workspaceMemberProfileChanged !== "object")
                    throw TypeError(".notification.WorkspaceNotification.workspaceMemberProfileChanged: object expected");
                message.workspaceMemberProfileChanged = $root.notification.WorkspaceMemberProfileChanged.fromObject(object.workspaceMemberProfileChanged);
            }
            if (object.folderChanged != null) {
                if (typeof object.folderChanged !== "object")
                    throw TypeError(".notification.WorkspaceNotification.folderChanged: object expected");
                message.folderChanged = $root.notification.FolderChanged.fromObject(object.folderChanged);
            }
            return message;
        };

        /**
         * Creates a plain object from a WorkspaceNotification message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {notification.WorkspaceNotification} message WorkspaceNotification
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        WorkspaceNotification.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (message.profileChange != null && message.hasOwnProperty("profileChange")) {
                object.profileChange = $root.notification.UserProfileChange.toObject(message.profileChange, options);
                if (options.oneofs)
                    object.payload = "profileChange";
            }
            if (message.permissionChanged != null && message.hasOwnProperty("permissionChanged")) {
                object.permissionChanged = $root.notification.PermissionChanged.toObject(message.permissionChanged, options);
                if (options.oneofs)
                    object.payload = "permissionChanged";
            }
            if (message.sectionChanged != null && message.hasOwnProperty("sectionChanged")) {
                object.sectionChanged = $root.notification.SectionChanged.toObject(message.sectionChanged, options);
                if (options.oneofs)
                    object.payload = "sectionChanged";
            }
            if (message.shareViewsChanged != null && message.hasOwnProperty("shareViewsChanged")) {
                object.shareViewsChanged = $root.notification.ShareViewsChanged.toObject(message.shareViewsChanged, options);
                if (options.oneofs)
                    object.payload = "shareViewsChanged";
            }
            if (message.mentionablePersonListChanged != null && message.hasOwnProperty("mentionablePersonListChanged")) {
                object.mentionablePersonListChanged = $root.notification.MentionablePersonListChanged.toObject(message.mentionablePersonListChanged, options);
                if (options.oneofs)
                    object.payload = "mentionablePersonListChanged";
            }
            if (message.serverLimit != null && message.hasOwnProperty("serverLimit")) {
                object.serverLimit = $root.notification.ServerLimit.toObject(message.serverLimit, options);
                if (options.oneofs)
                    object.payload = "serverLimit";
            }
            if (message.workspaceMemberProfileChanged != null && message.hasOwnProperty("workspaceMemberProfileChanged")) {
                object.workspaceMemberProfileChanged = $root.notification.WorkspaceMemberProfileChanged.toObject(message.workspaceMemberProfileChanged, options);
                if (options.oneofs)
                    object.payload = "workspaceMemberProfileChanged";
            }
            if (message.folderChanged != null && message.hasOwnProperty("folderChanged")) {
                object.folderChanged = $root.notification.FolderChanged.toObject(message.folderChanged, options);
                if (options.oneofs)
                    object.payload = "folderChanged";
            }
            return object;
        };

        /**
         * Converts this WorkspaceNotification to JSON.
         * @function toJSON
         * @memberof notification.WorkspaceNotification
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        WorkspaceNotification.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for WorkspaceNotification
         * @function getTypeUrl
         * @memberof notification.WorkspaceNotification
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        WorkspaceNotification.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.WorkspaceNotification";
        };

        return WorkspaceNotification;
    })();

    notification.UserProfileChange = (function() {

        /**
         * Properties of a UserProfileChange.
         * @memberof notification
         * @interface IUserProfileChange
         * @property {number|Long|null} [uid] UserProfileChange uid
         * @property {string|null} [name] UserProfileChange name
         * @property {string|null} [email] UserProfileChange email
         */

        /**
         * Constructs a new UserProfileChange.
         * @memberof notification
         * @classdesc Represents a UserProfileChange.
         * @implements IUserProfileChange
         * @constructor
         * @param {notification.IUserProfileChange=} [properties] Properties to set
         */
        function UserProfileChange(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * UserProfileChange uid.
         * @member {number|Long} uid
         * @memberof notification.UserProfileChange
         * @instance
         */
        UserProfileChange.prototype.uid = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * UserProfileChange name.
         * @member {string|null|undefined} name
         * @memberof notification.UserProfileChange
         * @instance
         */
        UserProfileChange.prototype.name = null;

        /**
         * UserProfileChange email.
         * @member {string|null|undefined} email
         * @memberof notification.UserProfileChange
         * @instance
         */
        UserProfileChange.prototype.email = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * UserProfileChange _name.
         * @member {"name"|undefined} _name
         * @memberof notification.UserProfileChange
         * @instance
         */
        Object.defineProperty(UserProfileChange.prototype, "_name", {
            get: $util.oneOfGetter($oneOfFields = ["name"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * UserProfileChange _email.
         * @member {"email"|undefined} _email
         * @memberof notification.UserProfileChange
         * @instance
         */
        Object.defineProperty(UserProfileChange.prototype, "_email", {
            get: $util.oneOfGetter($oneOfFields = ["email"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new UserProfileChange instance using the specified properties.
         * @function create
         * @memberof notification.UserProfileChange
         * @static
         * @param {notification.IUserProfileChange=} [properties] Properties to set
         * @returns {notification.UserProfileChange} UserProfileChange instance
         */
        UserProfileChange.create = function create(properties) {
            return new UserProfileChange(properties);
        };

        /**
         * Encodes the specified UserProfileChange message. Does not implicitly {@link notification.UserProfileChange.verify|verify} messages.
         * @function encode
         * @memberof notification.UserProfileChange
         * @static
         * @param {notification.IUserProfileChange} message UserProfileChange message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        UserProfileChange.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.uid != null && Object.hasOwnProperty.call(message, "uid"))
                writer.uint32(/* id 1, wireType 0 =*/8).int64(message.uid);
            if (message.name != null && Object.hasOwnProperty.call(message, "name"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.name);
            if (message.email != null && Object.hasOwnProperty.call(message, "email"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.email);
            return writer;
        };

        /**
         * Encodes the specified UserProfileChange message, length delimited. Does not implicitly {@link notification.UserProfileChange.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.UserProfileChange
         * @static
         * @param {notification.IUserProfileChange} message UserProfileChange message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        UserProfileChange.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a UserProfileChange message from the specified reader or buffer.
         * @function decode
         * @memberof notification.UserProfileChange
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.UserProfileChange} UserProfileChange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        UserProfileChange.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.UserProfileChange();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.uid = reader.int64();
                        break;
                    }
                case 2: {
                        message.name = reader.string();
                        break;
                    }
                case 3: {
                        message.email = reader.string();
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
         * Decodes a UserProfileChange message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.UserProfileChange
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.UserProfileChange} UserProfileChange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        UserProfileChange.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a UserProfileChange message.
         * @function verify
         * @memberof notification.UserProfileChange
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        UserProfileChange.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.uid != null && message.hasOwnProperty("uid"))
                if (!$util.isInteger(message.uid) && !(message.uid && $util.isInteger(message.uid.low) && $util.isInteger(message.uid.high)))
                    return "uid: integer|Long expected";
            if (message.name != null && message.hasOwnProperty("name")) {
                properties._name = 1;
                if (!$util.isString(message.name))
                    return "name: string expected";
            }
            if (message.email != null && message.hasOwnProperty("email")) {
                properties._email = 1;
                if (!$util.isString(message.email))
                    return "email: string expected";
            }
            return null;
        };

        /**
         * Creates a UserProfileChange message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.UserProfileChange
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.UserProfileChange} UserProfileChange
         */
        UserProfileChange.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.UserProfileChange)
                return object;
            let message = new $root.notification.UserProfileChange();
            if (object.uid != null)
                if ($util.Long)
                    (message.uid = $util.Long.fromValue(object.uid)).unsigned = false;
                else if (typeof object.uid === "string")
                    message.uid = parseInt(object.uid, 10);
                else if (typeof object.uid === "number")
                    message.uid = object.uid;
                else if (typeof object.uid === "object")
                    message.uid = new $util.LongBits(object.uid.low >>> 0, object.uid.high >>> 0).toNumber();
            if (object.name != null)
                message.name = String(object.name);
            if (object.email != null)
                message.email = String(object.email);
            return message;
        };

        /**
         * Creates a plain object from a UserProfileChange message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.UserProfileChange
         * @static
         * @param {notification.UserProfileChange} message UserProfileChange
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        UserProfileChange.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.uid = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.uid = options.longs === String ? "0" : 0;
            if (message.uid != null && message.hasOwnProperty("uid"))
                if (typeof message.uid === "number")
                    object.uid = options.longs === String ? String(message.uid) : message.uid;
                else
                    object.uid = options.longs === String ? $util.Long.prototype.toString.call(message.uid) : options.longs === Number ? new $util.LongBits(message.uid.low >>> 0, message.uid.high >>> 0).toNumber() : message.uid;
            if (message.name != null && message.hasOwnProperty("name")) {
                object.name = message.name;
                if (options.oneofs)
                    object._name = "name";
            }
            if (message.email != null && message.hasOwnProperty("email")) {
                object.email = message.email;
                if (options.oneofs)
                    object._email = "email";
            }
            return object;
        };

        /**
         * Converts this UserProfileChange to JSON.
         * @function toJSON
         * @memberof notification.UserProfileChange
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        UserProfileChange.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for UserProfileChange
         * @function getTypeUrl
         * @memberof notification.UserProfileChange
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        UserProfileChange.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.UserProfileChange";
        };

        return UserProfileChange;
    })();

    notification.PermissionChanged = (function() {

        /**
         * Properties of a PermissionChanged.
         * @memberof notification
         * @interface IPermissionChanged
         * @property {string|null} [objectId] PermissionChanged objectId
         * @property {number|null} [reason] PermissionChanged reason
         */

        /**
         * Constructs a new PermissionChanged.
         * @memberof notification
         * @classdesc Represents a PermissionChanged.
         * @implements IPermissionChanged
         * @constructor
         * @param {notification.IPermissionChanged=} [properties] Properties to set
         */
        function PermissionChanged(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * PermissionChanged objectId.
         * @member {string} objectId
         * @memberof notification.PermissionChanged
         * @instance
         */
        PermissionChanged.prototype.objectId = "";

        /**
         * PermissionChanged reason.
         * @member {number} reason
         * @memberof notification.PermissionChanged
         * @instance
         */
        PermissionChanged.prototype.reason = 0;

        /**
         * Creates a new PermissionChanged instance using the specified properties.
         * @function create
         * @memberof notification.PermissionChanged
         * @static
         * @param {notification.IPermissionChanged=} [properties] Properties to set
         * @returns {notification.PermissionChanged} PermissionChanged instance
         */
        PermissionChanged.create = function create(properties) {
            return new PermissionChanged(properties);
        };

        /**
         * Encodes the specified PermissionChanged message. Does not implicitly {@link notification.PermissionChanged.verify|verify} messages.
         * @function encode
         * @memberof notification.PermissionChanged
         * @static
         * @param {notification.IPermissionChanged} message PermissionChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        PermissionChanged.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.objectId != null && Object.hasOwnProperty.call(message, "objectId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.objectId);
            if (message.reason != null && Object.hasOwnProperty.call(message, "reason"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.reason);
            return writer;
        };

        /**
         * Encodes the specified PermissionChanged message, length delimited. Does not implicitly {@link notification.PermissionChanged.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.PermissionChanged
         * @static
         * @param {notification.IPermissionChanged} message PermissionChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        PermissionChanged.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a PermissionChanged message from the specified reader or buffer.
         * @function decode
         * @memberof notification.PermissionChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.PermissionChanged} PermissionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        PermissionChanged.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.PermissionChanged();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.objectId = reader.string();
                        break;
                    }
                case 2: {
                        message.reason = reader.uint32();
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
         * Decodes a PermissionChanged message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.PermissionChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.PermissionChanged} PermissionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        PermissionChanged.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a PermissionChanged message.
         * @function verify
         * @memberof notification.PermissionChanged
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        PermissionChanged.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.objectId != null && message.hasOwnProperty("objectId"))
                if (!$util.isString(message.objectId))
                    return "objectId: string expected";
            if (message.reason != null && message.hasOwnProperty("reason"))
                if (!$util.isInteger(message.reason))
                    return "reason: integer expected";
            return null;
        };

        /**
         * Creates a PermissionChanged message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.PermissionChanged
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.PermissionChanged} PermissionChanged
         */
        PermissionChanged.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.PermissionChanged)
                return object;
            let message = new $root.notification.PermissionChanged();
            if (object.objectId != null)
                message.objectId = String(object.objectId);
            if (object.reason != null)
                message.reason = object.reason >>> 0;
            return message;
        };

        /**
         * Creates a plain object from a PermissionChanged message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.PermissionChanged
         * @static
         * @param {notification.PermissionChanged} message PermissionChanged
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        PermissionChanged.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.objectId = "";
                object.reason = 0;
            }
            if (message.objectId != null && message.hasOwnProperty("objectId"))
                object.objectId = message.objectId;
            if (message.reason != null && message.hasOwnProperty("reason"))
                object.reason = message.reason;
            return object;
        };

        /**
         * Converts this PermissionChanged to JSON.
         * @function toJSON
         * @memberof notification.PermissionChanged
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        PermissionChanged.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for PermissionChanged
         * @function getTypeUrl
         * @memberof notification.PermissionChanged
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        PermissionChanged.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.PermissionChanged";
        };

        return PermissionChanged;
    })();

    notification.SectionChanged = (function() {

        /**
         * Properties of a SectionChanged.
         * @memberof notification
         * @interface ISectionChanged
         * @property {string|null} [data] SectionChanged data
         */

        /**
         * Constructs a new SectionChanged.
         * @memberof notification
         * @classdesc Represents a SectionChanged.
         * @implements ISectionChanged
         * @constructor
         * @param {notification.ISectionChanged=} [properties] Properties to set
         */
        function SectionChanged(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * SectionChanged data.
         * @member {string} data
         * @memberof notification.SectionChanged
         * @instance
         */
        SectionChanged.prototype.data = "";

        /**
         * Creates a new SectionChanged instance using the specified properties.
         * @function create
         * @memberof notification.SectionChanged
         * @static
         * @param {notification.ISectionChanged=} [properties] Properties to set
         * @returns {notification.SectionChanged} SectionChanged instance
         */
        SectionChanged.create = function create(properties) {
            return new SectionChanged(properties);
        };

        /**
         * Encodes the specified SectionChanged message. Does not implicitly {@link notification.SectionChanged.verify|verify} messages.
         * @function encode
         * @memberof notification.SectionChanged
         * @static
         * @param {notification.ISectionChanged} message SectionChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        SectionChanged.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.data != null && Object.hasOwnProperty.call(message, "data"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.data);
            return writer;
        };

        /**
         * Encodes the specified SectionChanged message, length delimited. Does not implicitly {@link notification.SectionChanged.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.SectionChanged
         * @static
         * @param {notification.ISectionChanged} message SectionChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        SectionChanged.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a SectionChanged message from the specified reader or buffer.
         * @function decode
         * @memberof notification.SectionChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.SectionChanged} SectionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        SectionChanged.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.SectionChanged();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.data = reader.string();
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
         * Decodes a SectionChanged message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.SectionChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.SectionChanged} SectionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        SectionChanged.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a SectionChanged message.
         * @function verify
         * @memberof notification.SectionChanged
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        SectionChanged.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.data != null && message.hasOwnProperty("data"))
                if (!$util.isString(message.data))
                    return "data: string expected";
            return null;
        };

        /**
         * Creates a SectionChanged message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.SectionChanged
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.SectionChanged} SectionChanged
         */
        SectionChanged.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.SectionChanged)
                return object;
            let message = new $root.notification.SectionChanged();
            if (object.data != null)
                message.data = String(object.data);
            return message;
        };

        /**
         * Creates a plain object from a SectionChanged message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.SectionChanged
         * @static
         * @param {notification.SectionChanged} message SectionChanged
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        SectionChanged.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                object.data = "";
            if (message.data != null && message.hasOwnProperty("data"))
                object.data = message.data;
            return object;
        };

        /**
         * Converts this SectionChanged to JSON.
         * @function toJSON
         * @memberof notification.SectionChanged
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        SectionChanged.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for SectionChanged
         * @function getTypeUrl
         * @memberof notification.SectionChanged
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        SectionChanged.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.SectionChanged";
        };

        return SectionChanged;
    })();

    notification.MentionablePersonListChanged = (function() {

        /**
         * Properties of a MentionablePersonListChanged.
         * @memberof notification
         * @interface IMentionablePersonListChanged
         * @property {notification.IUpdateMemberRole|null} [updateMemberRole] MentionablePersonListChanged updateMemberRole
         * @property {notification.IPageMention|null} [pageMention] MentionablePersonListChanged pageMention
         * @property {notification.INewMember|null} [newMember] MentionablePersonListChanged newMember
         * @property {notification.IRemovedMember|null} [removedMember] MentionablePersonListChanged removedMember
         */

        /**
         * Constructs a new MentionablePersonListChanged.
         * @memberof notification
         * @classdesc Represents a MentionablePersonListChanged.
         * @implements IMentionablePersonListChanged
         * @constructor
         * @param {notification.IMentionablePersonListChanged=} [properties] Properties to set
         */
        function MentionablePersonListChanged(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * MentionablePersonListChanged updateMemberRole.
         * @member {notification.IUpdateMemberRole|null|undefined} updateMemberRole
         * @memberof notification.MentionablePersonListChanged
         * @instance
         */
        MentionablePersonListChanged.prototype.updateMemberRole = null;

        /**
         * MentionablePersonListChanged pageMention.
         * @member {notification.IPageMention|null|undefined} pageMention
         * @memberof notification.MentionablePersonListChanged
         * @instance
         */
        MentionablePersonListChanged.prototype.pageMention = null;

        /**
         * MentionablePersonListChanged newMember.
         * @member {notification.INewMember|null|undefined} newMember
         * @memberof notification.MentionablePersonListChanged
         * @instance
         */
        MentionablePersonListChanged.prototype.newMember = null;

        /**
         * MentionablePersonListChanged removedMember.
         * @member {notification.IRemovedMember|null|undefined} removedMember
         * @memberof notification.MentionablePersonListChanged
         * @instance
         */
        MentionablePersonListChanged.prototype.removedMember = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * MentionablePersonListChanged payload.
         * @member {"updateMemberRole"|"pageMention"|"newMember"|"removedMember"|undefined} payload
         * @memberof notification.MentionablePersonListChanged
         * @instance
         */
        Object.defineProperty(MentionablePersonListChanged.prototype, "payload", {
            get: $util.oneOfGetter($oneOfFields = ["updateMemberRole", "pageMention", "newMember", "removedMember"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new MentionablePersonListChanged instance using the specified properties.
         * @function create
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {notification.IMentionablePersonListChanged=} [properties] Properties to set
         * @returns {notification.MentionablePersonListChanged} MentionablePersonListChanged instance
         */
        MentionablePersonListChanged.create = function create(properties) {
            return new MentionablePersonListChanged(properties);
        };

        /**
         * Encodes the specified MentionablePersonListChanged message. Does not implicitly {@link notification.MentionablePersonListChanged.verify|verify} messages.
         * @function encode
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {notification.IMentionablePersonListChanged} message MentionablePersonListChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MentionablePersonListChanged.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.updateMemberRole != null && Object.hasOwnProperty.call(message, "updateMemberRole"))
                $root.notification.UpdateMemberRole.encode(message.updateMemberRole, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
            if (message.pageMention != null && Object.hasOwnProperty.call(message, "pageMention"))
                $root.notification.PageMention.encode(message.pageMention, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
            if (message.newMember != null && Object.hasOwnProperty.call(message, "newMember"))
                $root.notification.NewMember.encode(message.newMember, writer.uint32(/* id 3, wireType 2 =*/26).fork()).ldelim();
            if (message.removedMember != null && Object.hasOwnProperty.call(message, "removedMember"))
                $root.notification.RemovedMember.encode(message.removedMember, writer.uint32(/* id 4, wireType 2 =*/34).fork()).ldelim();
            return writer;
        };

        /**
         * Encodes the specified MentionablePersonListChanged message, length delimited. Does not implicitly {@link notification.MentionablePersonListChanged.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {notification.IMentionablePersonListChanged} message MentionablePersonListChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        MentionablePersonListChanged.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a MentionablePersonListChanged message from the specified reader or buffer.
         * @function decode
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.MentionablePersonListChanged} MentionablePersonListChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MentionablePersonListChanged.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.MentionablePersonListChanged();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.updateMemberRole = $root.notification.UpdateMemberRole.decode(reader, reader.uint32());
                        break;
                    }
                case 2: {
                        message.pageMention = $root.notification.PageMention.decode(reader, reader.uint32());
                        break;
                    }
                case 3: {
                        message.newMember = $root.notification.NewMember.decode(reader, reader.uint32());
                        break;
                    }
                case 4: {
                        message.removedMember = $root.notification.RemovedMember.decode(reader, reader.uint32());
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
         * Decodes a MentionablePersonListChanged message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.MentionablePersonListChanged} MentionablePersonListChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        MentionablePersonListChanged.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a MentionablePersonListChanged message.
         * @function verify
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        MentionablePersonListChanged.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.updateMemberRole != null && message.hasOwnProperty("updateMemberRole")) {
                properties.payload = 1;
                {
                    let error = $root.notification.UpdateMemberRole.verify(message.updateMemberRole);
                    if (error)
                        return "updateMemberRole." + error;
                }
            }
            if (message.pageMention != null && message.hasOwnProperty("pageMention")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.PageMention.verify(message.pageMention);
                    if (error)
                        return "pageMention." + error;
                }
            }
            if (message.newMember != null && message.hasOwnProperty("newMember")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.NewMember.verify(message.newMember);
                    if (error)
                        return "newMember." + error;
                }
            }
            if (message.removedMember != null && message.hasOwnProperty("removedMember")) {
                if (properties.payload === 1)
                    return "payload: multiple values";
                properties.payload = 1;
                {
                    let error = $root.notification.RemovedMember.verify(message.removedMember);
                    if (error)
                        return "removedMember." + error;
                }
            }
            return null;
        };

        /**
         * Creates a MentionablePersonListChanged message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.MentionablePersonListChanged} MentionablePersonListChanged
         */
        MentionablePersonListChanged.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.MentionablePersonListChanged)
                return object;
            let message = new $root.notification.MentionablePersonListChanged();
            if (object.updateMemberRole != null) {
                if (typeof object.updateMemberRole !== "object")
                    throw TypeError(".notification.MentionablePersonListChanged.updateMemberRole: object expected");
                message.updateMemberRole = $root.notification.UpdateMemberRole.fromObject(object.updateMemberRole);
            }
            if (object.pageMention != null) {
                if (typeof object.pageMention !== "object")
                    throw TypeError(".notification.MentionablePersonListChanged.pageMention: object expected");
                message.pageMention = $root.notification.PageMention.fromObject(object.pageMention);
            }
            if (object.newMember != null) {
                if (typeof object.newMember !== "object")
                    throw TypeError(".notification.MentionablePersonListChanged.newMember: object expected");
                message.newMember = $root.notification.NewMember.fromObject(object.newMember);
            }
            if (object.removedMember != null) {
                if (typeof object.removedMember !== "object")
                    throw TypeError(".notification.MentionablePersonListChanged.removedMember: object expected");
                message.removedMember = $root.notification.RemovedMember.fromObject(object.removedMember);
            }
            return message;
        };

        /**
         * Creates a plain object from a MentionablePersonListChanged message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {notification.MentionablePersonListChanged} message MentionablePersonListChanged
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        MentionablePersonListChanged.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (message.updateMemberRole != null && message.hasOwnProperty("updateMemberRole")) {
                object.updateMemberRole = $root.notification.UpdateMemberRole.toObject(message.updateMemberRole, options);
                if (options.oneofs)
                    object.payload = "updateMemberRole";
            }
            if (message.pageMention != null && message.hasOwnProperty("pageMention")) {
                object.pageMention = $root.notification.PageMention.toObject(message.pageMention, options);
                if (options.oneofs)
                    object.payload = "pageMention";
            }
            if (message.newMember != null && message.hasOwnProperty("newMember")) {
                object.newMember = $root.notification.NewMember.toObject(message.newMember, options);
                if (options.oneofs)
                    object.payload = "newMember";
            }
            if (message.removedMember != null && message.hasOwnProperty("removedMember")) {
                object.removedMember = $root.notification.RemovedMember.toObject(message.removedMember, options);
                if (options.oneofs)
                    object.payload = "removedMember";
            }
            return object;
        };

        /**
         * Converts this MentionablePersonListChanged to JSON.
         * @function toJSON
         * @memberof notification.MentionablePersonListChanged
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        MentionablePersonListChanged.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for MentionablePersonListChanged
         * @function getTypeUrl
         * @memberof notification.MentionablePersonListChanged
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        MentionablePersonListChanged.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.MentionablePersonListChanged";
        };

        return MentionablePersonListChanged;
    })();

    notification.NewMember = (function() {

        /**
         * Properties of a NewMember.
         * @memberof notification
         * @interface INewMember
         * @property {string|null} [userUuid] NewMember userUuid
         */

        /**
         * Constructs a new NewMember.
         * @memberof notification
         * @classdesc Represents a NewMember.
         * @implements INewMember
         * @constructor
         * @param {notification.INewMember=} [properties] Properties to set
         */
        function NewMember(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * NewMember userUuid.
         * @member {string} userUuid
         * @memberof notification.NewMember
         * @instance
         */
        NewMember.prototype.userUuid = "";

        /**
         * Creates a new NewMember instance using the specified properties.
         * @function create
         * @memberof notification.NewMember
         * @static
         * @param {notification.INewMember=} [properties] Properties to set
         * @returns {notification.NewMember} NewMember instance
         */
        NewMember.create = function create(properties) {
            return new NewMember(properties);
        };

        /**
         * Encodes the specified NewMember message. Does not implicitly {@link notification.NewMember.verify|verify} messages.
         * @function encode
         * @memberof notification.NewMember
         * @static
         * @param {notification.INewMember} message NewMember message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        NewMember.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.userUuid != null && Object.hasOwnProperty.call(message, "userUuid"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.userUuid);
            return writer;
        };

        /**
         * Encodes the specified NewMember message, length delimited. Does not implicitly {@link notification.NewMember.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.NewMember
         * @static
         * @param {notification.INewMember} message NewMember message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        NewMember.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a NewMember message from the specified reader or buffer.
         * @function decode
         * @memberof notification.NewMember
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.NewMember} NewMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        NewMember.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.NewMember();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.userUuid = reader.string();
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
         * Decodes a NewMember message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.NewMember
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.NewMember} NewMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        NewMember.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a NewMember message.
         * @function verify
         * @memberof notification.NewMember
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        NewMember.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                if (!$util.isString(message.userUuid))
                    return "userUuid: string expected";
            return null;
        };

        /**
         * Creates a NewMember message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.NewMember
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.NewMember} NewMember
         */
        NewMember.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.NewMember)
                return object;
            let message = new $root.notification.NewMember();
            if (object.userUuid != null)
                message.userUuid = String(object.userUuid);
            return message;
        };

        /**
         * Creates a plain object from a NewMember message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.NewMember
         * @static
         * @param {notification.NewMember} message NewMember
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        NewMember.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                object.userUuid = "";
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                object.userUuid = message.userUuid;
            return object;
        };

        /**
         * Converts this NewMember to JSON.
         * @function toJSON
         * @memberof notification.NewMember
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        NewMember.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for NewMember
         * @function getTypeUrl
         * @memberof notification.NewMember
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        NewMember.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.NewMember";
        };

        return NewMember;
    })();

    notification.RemovedMember = (function() {

        /**
         * Properties of a RemovedMember.
         * @memberof notification
         * @interface IRemovedMember
         * @property {string|null} [userUuid] RemovedMember userUuid
         */

        /**
         * Constructs a new RemovedMember.
         * @memberof notification
         * @classdesc Represents a RemovedMember.
         * @implements IRemovedMember
         * @constructor
         * @param {notification.IRemovedMember=} [properties] Properties to set
         */
        function RemovedMember(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * RemovedMember userUuid.
         * @member {string} userUuid
         * @memberof notification.RemovedMember
         * @instance
         */
        RemovedMember.prototype.userUuid = "";

        /**
         * Creates a new RemovedMember instance using the specified properties.
         * @function create
         * @memberof notification.RemovedMember
         * @static
         * @param {notification.IRemovedMember=} [properties] Properties to set
         * @returns {notification.RemovedMember} RemovedMember instance
         */
        RemovedMember.create = function create(properties) {
            return new RemovedMember(properties);
        };

        /**
         * Encodes the specified RemovedMember message. Does not implicitly {@link notification.RemovedMember.verify|verify} messages.
         * @function encode
         * @memberof notification.RemovedMember
         * @static
         * @param {notification.IRemovedMember} message RemovedMember message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        RemovedMember.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.userUuid != null && Object.hasOwnProperty.call(message, "userUuid"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.userUuid);
            return writer;
        };

        /**
         * Encodes the specified RemovedMember message, length delimited. Does not implicitly {@link notification.RemovedMember.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.RemovedMember
         * @static
         * @param {notification.IRemovedMember} message RemovedMember message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        RemovedMember.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a RemovedMember message from the specified reader or buffer.
         * @function decode
         * @memberof notification.RemovedMember
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.RemovedMember} RemovedMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        RemovedMember.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.RemovedMember();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.userUuid = reader.string();
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
         * Decodes a RemovedMember message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.RemovedMember
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.RemovedMember} RemovedMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        RemovedMember.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a RemovedMember message.
         * @function verify
         * @memberof notification.RemovedMember
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        RemovedMember.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                if (!$util.isString(message.userUuid))
                    return "userUuid: string expected";
            return null;
        };

        /**
         * Creates a RemovedMember message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.RemovedMember
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.RemovedMember} RemovedMember
         */
        RemovedMember.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.RemovedMember)
                return object;
            let message = new $root.notification.RemovedMember();
            if (object.userUuid != null)
                message.userUuid = String(object.userUuid);
            return message;
        };

        /**
         * Creates a plain object from a RemovedMember message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.RemovedMember
         * @static
         * @param {notification.RemovedMember} message RemovedMember
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        RemovedMember.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                object.userUuid = "";
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                object.userUuid = message.userUuid;
            return object;
        };

        /**
         * Converts this RemovedMember to JSON.
         * @function toJSON
         * @memberof notification.RemovedMember
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        RemovedMember.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for RemovedMember
         * @function getTypeUrl
         * @memberof notification.RemovedMember
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        RemovedMember.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.RemovedMember";
        };

        return RemovedMember;
    })();

    notification.UpdateMemberRole = (function() {

        /**
         * Properties of an UpdateMemberRole.
         * @memberof notification
         * @interface IUpdateMemberRole
         * @property {string|null} [userUuid] UpdateMemberRole userUuid
         * @property {string|null} [email] UpdateMemberRole email
         * @property {number|null} [role] UpdateMemberRole role
         */

        /**
         * Constructs a new UpdateMemberRole.
         * @memberof notification
         * @classdesc Represents an UpdateMemberRole.
         * @implements IUpdateMemberRole
         * @constructor
         * @param {notification.IUpdateMemberRole=} [properties] Properties to set
         */
        function UpdateMemberRole(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * UpdateMemberRole userUuid.
         * @member {string} userUuid
         * @memberof notification.UpdateMemberRole
         * @instance
         */
        UpdateMemberRole.prototype.userUuid = "";

        /**
         * UpdateMemberRole email.
         * @member {string} email
         * @memberof notification.UpdateMemberRole
         * @instance
         */
        UpdateMemberRole.prototype.email = "";

        /**
         * UpdateMemberRole role.
         * @member {number} role
         * @memberof notification.UpdateMemberRole
         * @instance
         */
        UpdateMemberRole.prototype.role = 0;

        /**
         * Creates a new UpdateMemberRole instance using the specified properties.
         * @function create
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {notification.IUpdateMemberRole=} [properties] Properties to set
         * @returns {notification.UpdateMemberRole} UpdateMemberRole instance
         */
        UpdateMemberRole.create = function create(properties) {
            return new UpdateMemberRole(properties);
        };

        /**
         * Encodes the specified UpdateMemberRole message. Does not implicitly {@link notification.UpdateMemberRole.verify|verify} messages.
         * @function encode
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {notification.IUpdateMemberRole} message UpdateMemberRole message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        UpdateMemberRole.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.userUuid != null && Object.hasOwnProperty.call(message, "userUuid"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.userUuid);
            if (message.email != null && Object.hasOwnProperty.call(message, "email"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.email);
            if (message.role != null && Object.hasOwnProperty.call(message, "role"))
                writer.uint32(/* id 3, wireType 0 =*/24).int32(message.role);
            return writer;
        };

        /**
         * Encodes the specified UpdateMemberRole message, length delimited. Does not implicitly {@link notification.UpdateMemberRole.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {notification.IUpdateMemberRole} message UpdateMemberRole message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        UpdateMemberRole.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes an UpdateMemberRole message from the specified reader or buffer.
         * @function decode
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.UpdateMemberRole} UpdateMemberRole
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        UpdateMemberRole.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.UpdateMemberRole();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.userUuid = reader.string();
                        break;
                    }
                case 2: {
                        message.email = reader.string();
                        break;
                    }
                case 3: {
                        message.role = reader.int32();
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
         * Decodes an UpdateMemberRole message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.UpdateMemberRole} UpdateMemberRole
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        UpdateMemberRole.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies an UpdateMemberRole message.
         * @function verify
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        UpdateMemberRole.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                if (!$util.isString(message.userUuid))
                    return "userUuid: string expected";
            if (message.email != null && message.hasOwnProperty("email"))
                if (!$util.isString(message.email))
                    return "email: string expected";
            if (message.role != null && message.hasOwnProperty("role"))
                if (!$util.isInteger(message.role))
                    return "role: integer expected";
            return null;
        };

        /**
         * Creates an UpdateMemberRole message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.UpdateMemberRole} UpdateMemberRole
         */
        UpdateMemberRole.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.UpdateMemberRole)
                return object;
            let message = new $root.notification.UpdateMemberRole();
            if (object.userUuid != null)
                message.userUuid = String(object.userUuid);
            if (object.email != null)
                message.email = String(object.email);
            if (object.role != null)
                message.role = object.role | 0;
            return message;
        };

        /**
         * Creates a plain object from an UpdateMemberRole message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {notification.UpdateMemberRole} message UpdateMemberRole
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        UpdateMemberRole.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.userUuid = "";
                object.email = "";
                object.role = 0;
            }
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                object.userUuid = message.userUuid;
            if (message.email != null && message.hasOwnProperty("email"))
                object.email = message.email;
            if (message.role != null && message.hasOwnProperty("role"))
                object.role = message.role;
            return object;
        };

        /**
         * Converts this UpdateMemberRole to JSON.
         * @function toJSON
         * @memberof notification.UpdateMemberRole
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        UpdateMemberRole.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for UpdateMemberRole
         * @function getTypeUrl
         * @memberof notification.UpdateMemberRole
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        UpdateMemberRole.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.UpdateMemberRole";
        };

        return UpdateMemberRole;
    })();

    notification.PageMention = (function() {

        /**
         * Properties of a PageMention.
         * @memberof notification
         * @interface IPageMention
         * @property {string|null} [userUuid] PageMention userUuid
         * @property {string|null} [viewId] PageMention viewId
         * @property {number|Long|null} [mentionedAt] PageMention mentionedAt
         */

        /**
         * Constructs a new PageMention.
         * @memberof notification
         * @classdesc Represents a PageMention.
         * @implements IPageMention
         * @constructor
         * @param {notification.IPageMention=} [properties] Properties to set
         */
        function PageMention(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * PageMention userUuid.
         * @member {string} userUuid
         * @memberof notification.PageMention
         * @instance
         */
        PageMention.prototype.userUuid = "";

        /**
         * PageMention viewId.
         * @member {string} viewId
         * @memberof notification.PageMention
         * @instance
         */
        PageMention.prototype.viewId = "";

        /**
         * PageMention mentionedAt.
         * @member {number|Long} mentionedAt
         * @memberof notification.PageMention
         * @instance
         */
        PageMention.prototype.mentionedAt = $util.Long ? $util.Long.fromBits(0,0,false) : 0;

        /**
         * Creates a new PageMention instance using the specified properties.
         * @function create
         * @memberof notification.PageMention
         * @static
         * @param {notification.IPageMention=} [properties] Properties to set
         * @returns {notification.PageMention} PageMention instance
         */
        PageMention.create = function create(properties) {
            return new PageMention(properties);
        };

        /**
         * Encodes the specified PageMention message. Does not implicitly {@link notification.PageMention.verify|verify} messages.
         * @function encode
         * @memberof notification.PageMention
         * @static
         * @param {notification.IPageMention} message PageMention message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        PageMention.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.userUuid != null && Object.hasOwnProperty.call(message, "userUuid"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.userUuid);
            if (message.viewId != null && Object.hasOwnProperty.call(message, "viewId"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.viewId);
            if (message.mentionedAt != null && Object.hasOwnProperty.call(message, "mentionedAt"))
                writer.uint32(/* id 3, wireType 0 =*/24).int64(message.mentionedAt);
            return writer;
        };

        /**
         * Encodes the specified PageMention message, length delimited. Does not implicitly {@link notification.PageMention.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.PageMention
         * @static
         * @param {notification.IPageMention} message PageMention message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        PageMention.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a PageMention message from the specified reader or buffer.
         * @function decode
         * @memberof notification.PageMention
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.PageMention} PageMention
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        PageMention.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.PageMention();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.userUuid = reader.string();
                        break;
                    }
                case 2: {
                        message.viewId = reader.string();
                        break;
                    }
                case 3: {
                        message.mentionedAt = reader.int64();
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
         * Decodes a PageMention message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.PageMention
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.PageMention} PageMention
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        PageMention.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a PageMention message.
         * @function verify
         * @memberof notification.PageMention
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        PageMention.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                if (!$util.isString(message.userUuid))
                    return "userUuid: string expected";
            if (message.viewId != null && message.hasOwnProperty("viewId"))
                if (!$util.isString(message.viewId))
                    return "viewId: string expected";
            if (message.mentionedAt != null && message.hasOwnProperty("mentionedAt"))
                if (!$util.isInteger(message.mentionedAt) && !(message.mentionedAt && $util.isInteger(message.mentionedAt.low) && $util.isInteger(message.mentionedAt.high)))
                    return "mentionedAt: integer|Long expected";
            return null;
        };

        /**
         * Creates a PageMention message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.PageMention
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.PageMention} PageMention
         */
        PageMention.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.PageMention)
                return object;
            let message = new $root.notification.PageMention();
            if (object.userUuid != null)
                message.userUuid = String(object.userUuid);
            if (object.viewId != null)
                message.viewId = String(object.viewId);
            if (object.mentionedAt != null)
                if ($util.Long)
                    (message.mentionedAt = $util.Long.fromValue(object.mentionedAt)).unsigned = false;
                else if (typeof object.mentionedAt === "string")
                    message.mentionedAt = parseInt(object.mentionedAt, 10);
                else if (typeof object.mentionedAt === "number")
                    message.mentionedAt = object.mentionedAt;
                else if (typeof object.mentionedAt === "object")
                    message.mentionedAt = new $util.LongBits(object.mentionedAt.low >>> 0, object.mentionedAt.high >>> 0).toNumber();
            return message;
        };

        /**
         * Creates a plain object from a PageMention message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.PageMention
         * @static
         * @param {notification.PageMention} message PageMention
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        PageMention.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.userUuid = "";
                object.viewId = "";
                if ($util.Long) {
                    let long = new $util.Long(0, 0, false);
                    object.mentionedAt = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.mentionedAt = options.longs === String ? "0" : 0;
            }
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                object.userUuid = message.userUuid;
            if (message.viewId != null && message.hasOwnProperty("viewId"))
                object.viewId = message.viewId;
            if (message.mentionedAt != null && message.hasOwnProperty("mentionedAt"))
                if (typeof message.mentionedAt === "number")
                    object.mentionedAt = options.longs === String ? String(message.mentionedAt) : message.mentionedAt;
                else
                    object.mentionedAt = options.longs === String ? $util.Long.prototype.toString.call(message.mentionedAt) : options.longs === Number ? new $util.LongBits(message.mentionedAt.low >>> 0, message.mentionedAt.high >>> 0).toNumber() : message.mentionedAt;
            return object;
        };

        /**
         * Converts this PageMention to JSON.
         * @function toJSON
         * @memberof notification.PageMention
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        PageMention.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for PageMention
         * @function getTypeUrl
         * @memberof notification.PageMention
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        PageMention.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.PageMention";
        };

        return PageMention;
    })();

    notification.ShareViewsChanged = (function() {

        /**
         * Properties of a ShareViewsChanged.
         * @memberof notification
         * @interface IShareViewsChanged
         * @property {string|null} [viewId] ShareViewsChanged viewId
         * @property {Array.<string>|null} [emails] ShareViewsChanged emails
         */

        /**
         * Constructs a new ShareViewsChanged.
         * @memberof notification
         * @classdesc Represents a ShareViewsChanged.
         * @implements IShareViewsChanged
         * @constructor
         * @param {notification.IShareViewsChanged=} [properties] Properties to set
         */
        function ShareViewsChanged(properties) {
            this.emails = [];
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ShareViewsChanged viewId.
         * @member {string} viewId
         * @memberof notification.ShareViewsChanged
         * @instance
         */
        ShareViewsChanged.prototype.viewId = "";

        /**
         * ShareViewsChanged emails.
         * @member {Array.<string>} emails
         * @memberof notification.ShareViewsChanged
         * @instance
         */
        ShareViewsChanged.prototype.emails = $util.emptyArray;

        /**
         * Creates a new ShareViewsChanged instance using the specified properties.
         * @function create
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {notification.IShareViewsChanged=} [properties] Properties to set
         * @returns {notification.ShareViewsChanged} ShareViewsChanged instance
         */
        ShareViewsChanged.create = function create(properties) {
            return new ShareViewsChanged(properties);
        };

        /**
         * Encodes the specified ShareViewsChanged message. Does not implicitly {@link notification.ShareViewsChanged.verify|verify} messages.
         * @function encode
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {notification.IShareViewsChanged} message ShareViewsChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ShareViewsChanged.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.viewId != null && Object.hasOwnProperty.call(message, "viewId"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.viewId);
            if (message.emails != null && message.emails.length)
                for (let i = 0; i < message.emails.length; ++i)
                    writer.uint32(/* id 2, wireType 2 =*/18).string(message.emails[i]);
            return writer;
        };

        /**
         * Encodes the specified ShareViewsChanged message, length delimited. Does not implicitly {@link notification.ShareViewsChanged.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {notification.IShareViewsChanged} message ShareViewsChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ShareViewsChanged.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a ShareViewsChanged message from the specified reader or buffer.
         * @function decode
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.ShareViewsChanged} ShareViewsChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ShareViewsChanged.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.ShareViewsChanged();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.viewId = reader.string();
                        break;
                    }
                case 2: {
                        if (!(message.emails && message.emails.length))
                            message.emails = [];
                        message.emails.push(reader.string());
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
         * Decodes a ShareViewsChanged message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.ShareViewsChanged} ShareViewsChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ShareViewsChanged.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a ShareViewsChanged message.
         * @function verify
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ShareViewsChanged.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.viewId != null && message.hasOwnProperty("viewId"))
                if (!$util.isString(message.viewId))
                    return "viewId: string expected";
            if (message.emails != null && message.hasOwnProperty("emails")) {
                if (!Array.isArray(message.emails))
                    return "emails: array expected";
                for (let i = 0; i < message.emails.length; ++i)
                    if (!$util.isString(message.emails[i]))
                        return "emails: string[] expected";
            }
            return null;
        };

        /**
         * Creates a ShareViewsChanged message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.ShareViewsChanged} ShareViewsChanged
         */
        ShareViewsChanged.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.ShareViewsChanged)
                return object;
            let message = new $root.notification.ShareViewsChanged();
            if (object.viewId != null)
                message.viewId = String(object.viewId);
            if (object.emails) {
                if (!Array.isArray(object.emails))
                    throw TypeError(".notification.ShareViewsChanged.emails: array expected");
                message.emails = [];
                for (let i = 0; i < object.emails.length; ++i)
                    message.emails[i] = String(object.emails[i]);
            }
            return message;
        };

        /**
         * Creates a plain object from a ShareViewsChanged message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {notification.ShareViewsChanged} message ShareViewsChanged
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ShareViewsChanged.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.arrays || options.defaults)
                object.emails = [];
            if (options.defaults)
                object.viewId = "";
            if (message.viewId != null && message.hasOwnProperty("viewId"))
                object.viewId = message.viewId;
            if (message.emails && message.emails.length) {
                object.emails = [];
                for (let j = 0; j < message.emails.length; ++j)
                    object.emails[j] = message.emails[j];
            }
            return object;
        };

        /**
         * Converts this ShareViewsChanged to JSON.
         * @function toJSON
         * @memberof notification.ShareViewsChanged
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ShareViewsChanged.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for ShareViewsChanged
         * @function getTypeUrl
         * @memberof notification.ShareViewsChanged
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        ShareViewsChanged.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.ShareViewsChanged";
        };

        return ShareViewsChanged;
    })();

    notification.ServerLimit = (function() {

        /**
         * Properties of a ServerLimit.
         * @memberof notification
         * @interface IServerLimit
         * @property {Array.<number>|null} [features] ServerLimit features
         * @property {number|Long|null} [maxUsers] ServerLimit maxUsers
         * @property {number|Long|null} [maxGuests] ServerLimit maxGuests
         */

        /**
         * Constructs a new ServerLimit.
         * @memberof notification
         * @classdesc Represents a ServerLimit.
         * @implements IServerLimit
         * @constructor
         * @param {notification.IServerLimit=} [properties] Properties to set
         */
        function ServerLimit(properties) {
            this.features = [];
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * ServerLimit features.
         * @member {Array.<number>} features
         * @memberof notification.ServerLimit
         * @instance
         */
        ServerLimit.prototype.features = $util.emptyArray;

        /**
         * ServerLimit maxUsers.
         * @member {number|Long} maxUsers
         * @memberof notification.ServerLimit
         * @instance
         */
        ServerLimit.prototype.maxUsers = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * ServerLimit maxGuests.
         * @member {number|Long} maxGuests
         * @memberof notification.ServerLimit
         * @instance
         */
        ServerLimit.prototype.maxGuests = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

        /**
         * Creates a new ServerLimit instance using the specified properties.
         * @function create
         * @memberof notification.ServerLimit
         * @static
         * @param {notification.IServerLimit=} [properties] Properties to set
         * @returns {notification.ServerLimit} ServerLimit instance
         */
        ServerLimit.create = function create(properties) {
            return new ServerLimit(properties);
        };

        /**
         * Encodes the specified ServerLimit message. Does not implicitly {@link notification.ServerLimit.verify|verify} messages.
         * @function encode
         * @memberof notification.ServerLimit
         * @static
         * @param {notification.IServerLimit} message ServerLimit message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ServerLimit.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.features != null && message.features.length) {
                writer.uint32(/* id 1, wireType 2 =*/10).fork();
                for (let i = 0; i < message.features.length; ++i)
                    writer.int32(message.features[i]);
                writer.ldelim();
            }
            if (message.maxUsers != null && Object.hasOwnProperty.call(message, "maxUsers"))
                writer.uint32(/* id 2, wireType 0 =*/16).uint64(message.maxUsers);
            if (message.maxGuests != null && Object.hasOwnProperty.call(message, "maxGuests"))
                writer.uint32(/* id 3, wireType 0 =*/24).uint64(message.maxGuests);
            return writer;
        };

        /**
         * Encodes the specified ServerLimit message, length delimited. Does not implicitly {@link notification.ServerLimit.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.ServerLimit
         * @static
         * @param {notification.IServerLimit} message ServerLimit message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        ServerLimit.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a ServerLimit message from the specified reader or buffer.
         * @function decode
         * @memberof notification.ServerLimit
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.ServerLimit} ServerLimit
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ServerLimit.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.ServerLimit();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        if (!(message.features && message.features.length))
                            message.features = [];
                        if ((tag & 7) === 2) {
                            let end2 = reader.uint32() + reader.pos;
                            while (reader.pos < end2)
                                message.features.push(reader.int32());
                        } else
                            message.features.push(reader.int32());
                        break;
                    }
                case 2: {
                        message.maxUsers = reader.uint64();
                        break;
                    }
                case 3: {
                        message.maxGuests = reader.uint64();
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
         * Decodes a ServerLimit message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.ServerLimit
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.ServerLimit} ServerLimit
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        ServerLimit.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a ServerLimit message.
         * @function verify
         * @memberof notification.ServerLimit
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        ServerLimit.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            if (message.features != null && message.hasOwnProperty("features")) {
                if (!Array.isArray(message.features))
                    return "features: array expected";
                for (let i = 0; i < message.features.length; ++i)
                    if (!$util.isInteger(message.features[i]))
                        return "features: integer[] expected";
            }
            if (message.maxUsers != null && message.hasOwnProperty("maxUsers"))
                if (!$util.isInteger(message.maxUsers) && !(message.maxUsers && $util.isInteger(message.maxUsers.low) && $util.isInteger(message.maxUsers.high)))
                    return "maxUsers: integer|Long expected";
            if (message.maxGuests != null && message.hasOwnProperty("maxGuests"))
                if (!$util.isInteger(message.maxGuests) && !(message.maxGuests && $util.isInteger(message.maxGuests.low) && $util.isInteger(message.maxGuests.high)))
                    return "maxGuests: integer|Long expected";
            return null;
        };

        /**
         * Creates a ServerLimit message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.ServerLimit
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.ServerLimit} ServerLimit
         */
        ServerLimit.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.ServerLimit)
                return object;
            let message = new $root.notification.ServerLimit();
            if (object.features) {
                if (!Array.isArray(object.features))
                    throw TypeError(".notification.ServerLimit.features: array expected");
                message.features = [];
                for (let i = 0; i < object.features.length; ++i)
                    message.features[i] = object.features[i] | 0;
            }
            if (object.maxUsers != null)
                if ($util.Long)
                    (message.maxUsers = $util.Long.fromValue(object.maxUsers)).unsigned = true;
                else if (typeof object.maxUsers === "string")
                    message.maxUsers = parseInt(object.maxUsers, 10);
                else if (typeof object.maxUsers === "number")
                    message.maxUsers = object.maxUsers;
                else if (typeof object.maxUsers === "object")
                    message.maxUsers = new $util.LongBits(object.maxUsers.low >>> 0, object.maxUsers.high >>> 0).toNumber(true);
            if (object.maxGuests != null)
                if ($util.Long)
                    (message.maxGuests = $util.Long.fromValue(object.maxGuests)).unsigned = true;
                else if (typeof object.maxGuests === "string")
                    message.maxGuests = parseInt(object.maxGuests, 10);
                else if (typeof object.maxGuests === "number")
                    message.maxGuests = object.maxGuests;
                else if (typeof object.maxGuests === "object")
                    message.maxGuests = new $util.LongBits(object.maxGuests.low >>> 0, object.maxGuests.high >>> 0).toNumber(true);
            return message;
        };

        /**
         * Creates a plain object from a ServerLimit message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.ServerLimit
         * @static
         * @param {notification.ServerLimit} message ServerLimit
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        ServerLimit.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.arrays || options.defaults)
                object.features = [];
            if (options.defaults) {
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.maxUsers = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.maxUsers = options.longs === String ? "0" : 0;
                if ($util.Long) {
                    let long = new $util.Long(0, 0, true);
                    object.maxGuests = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                } else
                    object.maxGuests = options.longs === String ? "0" : 0;
            }
            if (message.features && message.features.length) {
                object.features = [];
                for (let j = 0; j < message.features.length; ++j)
                    object.features[j] = message.features[j];
            }
            if (message.maxUsers != null && message.hasOwnProperty("maxUsers"))
                if (typeof message.maxUsers === "number")
                    object.maxUsers = options.longs === String ? String(message.maxUsers) : message.maxUsers;
                else
                    object.maxUsers = options.longs === String ? $util.Long.prototype.toString.call(message.maxUsers) : options.longs === Number ? new $util.LongBits(message.maxUsers.low >>> 0, message.maxUsers.high >>> 0).toNumber(true) : message.maxUsers;
            if (message.maxGuests != null && message.hasOwnProperty("maxGuests"))
                if (typeof message.maxGuests === "number")
                    object.maxGuests = options.longs === String ? String(message.maxGuests) : message.maxGuests;
                else
                    object.maxGuests = options.longs === String ? $util.Long.prototype.toString.call(message.maxGuests) : options.longs === Number ? new $util.LongBits(message.maxGuests.low >>> 0, message.maxGuests.high >>> 0).toNumber(true) : message.maxGuests;
            return object;
        };

        /**
         * Converts this ServerLimit to JSON.
         * @function toJSON
         * @memberof notification.ServerLimit
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        ServerLimit.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for ServerLimit
         * @function getTypeUrl
         * @memberof notification.ServerLimit
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        ServerLimit.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.ServerLimit";
        };

        return ServerLimit;
    })();

    notification.WorkspaceMemberProfileChanged = (function() {

        /**
         * Properties of a WorkspaceMemberProfileChanged.
         * @memberof notification
         * @interface IWorkspaceMemberProfileChanged
         * @property {string|null} [userUuid] WorkspaceMemberProfileChanged userUuid
         * @property {string|null} [name] WorkspaceMemberProfileChanged name
         * @property {string|null} [avatarUrl] WorkspaceMemberProfileChanged avatarUrl
         * @property {string|null} [coverImageUrl] WorkspaceMemberProfileChanged coverImageUrl
         * @property {string|null} [customImageUrl] WorkspaceMemberProfileChanged customImageUrl
         * @property {string|null} [description] WorkspaceMemberProfileChanged description
         */

        /**
         * Constructs a new WorkspaceMemberProfileChanged.
         * @memberof notification
         * @classdesc Represents a WorkspaceMemberProfileChanged.
         * @implements IWorkspaceMemberProfileChanged
         * @constructor
         * @param {notification.IWorkspaceMemberProfileChanged=} [properties] Properties to set
         */
        function WorkspaceMemberProfileChanged(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * WorkspaceMemberProfileChanged userUuid.
         * @member {string} userUuid
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        WorkspaceMemberProfileChanged.prototype.userUuid = "";

        /**
         * WorkspaceMemberProfileChanged name.
         * @member {string} name
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        WorkspaceMemberProfileChanged.prototype.name = "";

        /**
         * WorkspaceMemberProfileChanged avatarUrl.
         * @member {string|null|undefined} avatarUrl
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        WorkspaceMemberProfileChanged.prototype.avatarUrl = null;

        /**
         * WorkspaceMemberProfileChanged coverImageUrl.
         * @member {string|null|undefined} coverImageUrl
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        WorkspaceMemberProfileChanged.prototype.coverImageUrl = null;

        /**
         * WorkspaceMemberProfileChanged customImageUrl.
         * @member {string|null|undefined} customImageUrl
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        WorkspaceMemberProfileChanged.prototype.customImageUrl = null;

        /**
         * WorkspaceMemberProfileChanged description.
         * @member {string|null|undefined} description
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        WorkspaceMemberProfileChanged.prototype.description = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * WorkspaceMemberProfileChanged _avatarUrl.
         * @member {"avatarUrl"|undefined} _avatarUrl
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        Object.defineProperty(WorkspaceMemberProfileChanged.prototype, "_avatarUrl", {
            get: $util.oneOfGetter($oneOfFields = ["avatarUrl"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * WorkspaceMemberProfileChanged _coverImageUrl.
         * @member {"coverImageUrl"|undefined} _coverImageUrl
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        Object.defineProperty(WorkspaceMemberProfileChanged.prototype, "_coverImageUrl", {
            get: $util.oneOfGetter($oneOfFields = ["coverImageUrl"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * WorkspaceMemberProfileChanged _customImageUrl.
         * @member {"customImageUrl"|undefined} _customImageUrl
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        Object.defineProperty(WorkspaceMemberProfileChanged.prototype, "_customImageUrl", {
            get: $util.oneOfGetter($oneOfFields = ["customImageUrl"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * WorkspaceMemberProfileChanged _description.
         * @member {"description"|undefined} _description
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         */
        Object.defineProperty(WorkspaceMemberProfileChanged.prototype, "_description", {
            get: $util.oneOfGetter($oneOfFields = ["description"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new WorkspaceMemberProfileChanged instance using the specified properties.
         * @function create
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {notification.IWorkspaceMemberProfileChanged=} [properties] Properties to set
         * @returns {notification.WorkspaceMemberProfileChanged} WorkspaceMemberProfileChanged instance
         */
        WorkspaceMemberProfileChanged.create = function create(properties) {
            return new WorkspaceMemberProfileChanged(properties);
        };

        /**
         * Encodes the specified WorkspaceMemberProfileChanged message. Does not implicitly {@link notification.WorkspaceMemberProfileChanged.verify|verify} messages.
         * @function encode
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {notification.IWorkspaceMemberProfileChanged} message WorkspaceMemberProfileChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        WorkspaceMemberProfileChanged.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.userUuid != null && Object.hasOwnProperty.call(message, "userUuid"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.userUuid);
            if (message.name != null && Object.hasOwnProperty.call(message, "name"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.name);
            if (message.avatarUrl != null && Object.hasOwnProperty.call(message, "avatarUrl"))
                writer.uint32(/* id 3, wireType 2 =*/26).string(message.avatarUrl);
            if (message.coverImageUrl != null && Object.hasOwnProperty.call(message, "coverImageUrl"))
                writer.uint32(/* id 4, wireType 2 =*/34).string(message.coverImageUrl);
            if (message.customImageUrl != null && Object.hasOwnProperty.call(message, "customImageUrl"))
                writer.uint32(/* id 5, wireType 2 =*/42).string(message.customImageUrl);
            if (message.description != null && Object.hasOwnProperty.call(message, "description"))
                writer.uint32(/* id 6, wireType 2 =*/50).string(message.description);
            return writer;
        };

        /**
         * Encodes the specified WorkspaceMemberProfileChanged message, length delimited. Does not implicitly {@link notification.WorkspaceMemberProfileChanged.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {notification.IWorkspaceMemberProfileChanged} message WorkspaceMemberProfileChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        WorkspaceMemberProfileChanged.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a WorkspaceMemberProfileChanged message from the specified reader or buffer.
         * @function decode
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.WorkspaceMemberProfileChanged} WorkspaceMemberProfileChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        WorkspaceMemberProfileChanged.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.WorkspaceMemberProfileChanged();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.userUuid = reader.string();
                        break;
                    }
                case 2: {
                        message.name = reader.string();
                        break;
                    }
                case 3: {
                        message.avatarUrl = reader.string();
                        break;
                    }
                case 4: {
                        message.coverImageUrl = reader.string();
                        break;
                    }
                case 5: {
                        message.customImageUrl = reader.string();
                        break;
                    }
                case 6: {
                        message.description = reader.string();
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
         * Decodes a WorkspaceMemberProfileChanged message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.WorkspaceMemberProfileChanged} WorkspaceMemberProfileChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        WorkspaceMemberProfileChanged.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a WorkspaceMemberProfileChanged message.
         * @function verify
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        WorkspaceMemberProfileChanged.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                if (!$util.isString(message.userUuid))
                    return "userUuid: string expected";
            if (message.name != null && message.hasOwnProperty("name"))
                if (!$util.isString(message.name))
                    return "name: string expected";
            if (message.avatarUrl != null && message.hasOwnProperty("avatarUrl")) {
                properties._avatarUrl = 1;
                if (!$util.isString(message.avatarUrl))
                    return "avatarUrl: string expected";
            }
            if (message.coverImageUrl != null && message.hasOwnProperty("coverImageUrl")) {
                properties._coverImageUrl = 1;
                if (!$util.isString(message.coverImageUrl))
                    return "coverImageUrl: string expected";
            }
            if (message.customImageUrl != null && message.hasOwnProperty("customImageUrl")) {
                properties._customImageUrl = 1;
                if (!$util.isString(message.customImageUrl))
                    return "customImageUrl: string expected";
            }
            if (message.description != null && message.hasOwnProperty("description")) {
                properties._description = 1;
                if (!$util.isString(message.description))
                    return "description: string expected";
            }
            return null;
        };

        /**
         * Creates a WorkspaceMemberProfileChanged message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.WorkspaceMemberProfileChanged} WorkspaceMemberProfileChanged
         */
        WorkspaceMemberProfileChanged.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.WorkspaceMemberProfileChanged)
                return object;
            let message = new $root.notification.WorkspaceMemberProfileChanged();
            if (object.userUuid != null)
                message.userUuid = String(object.userUuid);
            if (object.name != null)
                message.name = String(object.name);
            if (object.avatarUrl != null)
                message.avatarUrl = String(object.avatarUrl);
            if (object.coverImageUrl != null)
                message.coverImageUrl = String(object.coverImageUrl);
            if (object.customImageUrl != null)
                message.customImageUrl = String(object.customImageUrl);
            if (object.description != null)
                message.description = String(object.description);
            return message;
        };

        /**
         * Creates a plain object from a WorkspaceMemberProfileChanged message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {notification.WorkspaceMemberProfileChanged} message WorkspaceMemberProfileChanged
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        WorkspaceMemberProfileChanged.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults) {
                object.userUuid = "";
                object.name = "";
            }
            if (message.userUuid != null && message.hasOwnProperty("userUuid"))
                object.userUuid = message.userUuid;
            if (message.name != null && message.hasOwnProperty("name"))
                object.name = message.name;
            if (message.avatarUrl != null && message.hasOwnProperty("avatarUrl")) {
                object.avatarUrl = message.avatarUrl;
                if (options.oneofs)
                    object._avatarUrl = "avatarUrl";
            }
            if (message.coverImageUrl != null && message.hasOwnProperty("coverImageUrl")) {
                object.coverImageUrl = message.coverImageUrl;
                if (options.oneofs)
                    object._coverImageUrl = "coverImageUrl";
            }
            if (message.customImageUrl != null && message.hasOwnProperty("customImageUrl")) {
                object.customImageUrl = message.customImageUrl;
                if (options.oneofs)
                    object._customImageUrl = "customImageUrl";
            }
            if (message.description != null && message.hasOwnProperty("description")) {
                object.description = message.description;
                if (options.oneofs)
                    object._description = "description";
            }
            return object;
        };

        /**
         * Converts this WorkspaceMemberProfileChanged to JSON.
         * @function toJSON
         * @memberof notification.WorkspaceMemberProfileChanged
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        WorkspaceMemberProfileChanged.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for WorkspaceMemberProfileChanged
         * @function getTypeUrl
         * @memberof notification.WorkspaceMemberProfileChanged
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        WorkspaceMemberProfileChanged.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.WorkspaceMemberProfileChanged";
        };

        return WorkspaceMemberProfileChanged;
    })();

    notification.FolderChanged = (function() {

        /**
         * Properties of a FolderChanged.
         * @memberof notification
         * @interface IFolderChanged
         * @property {string|null} [outlineDiffJson] FolderChanged outlineDiffJson
         * @property {string|null} [folderRid] FolderChanged folderRid
         */

        /**
         * Constructs a new FolderChanged.
         * @memberof notification
         * @classdesc Represents a FolderChanged.
         * @implements IFolderChanged
         * @constructor
         * @param {notification.IFolderChanged=} [properties] Properties to set
         */
        function FolderChanged(properties) {
            if (properties)
                for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                    if (properties[keys[i]] != null)
                        this[keys[i]] = properties[keys[i]];
        }

        /**
         * FolderChanged outlineDiffJson.
         * @member {string} outlineDiffJson
         * @memberof notification.FolderChanged
         * @instance
         */
        FolderChanged.prototype.outlineDiffJson = "";

        /**
         * FolderChanged folderRid.
         * @member {string|null|undefined} folderRid
         * @memberof notification.FolderChanged
         * @instance
         */
        FolderChanged.prototype.folderRid = null;

        // OneOf field names bound to virtual getters and setters
        let $oneOfFields;

        /**
         * FolderChanged _folderRid.
         * @member {"folderRid"|undefined} _folderRid
         * @memberof notification.FolderChanged
         * @instance
         */
        Object.defineProperty(FolderChanged.prototype, "_folderRid", {
            get: $util.oneOfGetter($oneOfFields = ["folderRid"]),
            set: $util.oneOfSetter($oneOfFields)
        });

        /**
         * Creates a new FolderChanged instance using the specified properties.
         * @function create
         * @memberof notification.FolderChanged
         * @static
         * @param {notification.IFolderChanged=} [properties] Properties to set
         * @returns {notification.FolderChanged} FolderChanged instance
         */
        FolderChanged.create = function create(properties) {
            return new FolderChanged(properties);
        };

        /**
         * Encodes the specified FolderChanged message. Does not implicitly {@link notification.FolderChanged.verify|verify} messages.
         * @function encode
         * @memberof notification.FolderChanged
         * @static
         * @param {notification.IFolderChanged} message FolderChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        FolderChanged.encode = function encode(message, writer) {
            if (!writer)
                writer = $Writer.create();
            if (message.outlineDiffJson != null && Object.hasOwnProperty.call(message, "outlineDiffJson"))
                writer.uint32(/* id 1, wireType 2 =*/10).string(message.outlineDiffJson);
            if (message.folderRid != null && Object.hasOwnProperty.call(message, "folderRid"))
                writer.uint32(/* id 2, wireType 2 =*/18).string(message.folderRid);
            return writer;
        };

        /**
         * Encodes the specified FolderChanged message, length delimited. Does not implicitly {@link notification.FolderChanged.verify|verify} messages.
         * @function encodeDelimited
         * @memberof notification.FolderChanged
         * @static
         * @param {notification.IFolderChanged} message FolderChanged message or plain object to encode
         * @param {$protobuf.Writer} [writer] Writer to encode to
         * @returns {$protobuf.Writer} Writer
         */
        FolderChanged.encodeDelimited = function encodeDelimited(message, writer) {
            return this.encode(message, writer).ldelim();
        };

        /**
         * Decodes a FolderChanged message from the specified reader or buffer.
         * @function decode
         * @memberof notification.FolderChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @param {number} [length] Message length if known beforehand
         * @returns {notification.FolderChanged} FolderChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        FolderChanged.decode = function decode(reader, length, error) {
            if (!(reader instanceof $Reader))
                reader = $Reader.create(reader);
            let end = length === undefined ? reader.len : reader.pos + length, message = new $root.notification.FolderChanged();
            while (reader.pos < end) {
                let tag = reader.uint32();
                if (tag === error)
                    break;
                switch (tag >>> 3) {
                case 1: {
                        message.outlineDiffJson = reader.string();
                        break;
                    }
                case 2: {
                        message.folderRid = reader.string();
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
         * Decodes a FolderChanged message from the specified reader or buffer, length delimited.
         * @function decodeDelimited
         * @memberof notification.FolderChanged
         * @static
         * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
         * @returns {notification.FolderChanged} FolderChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        FolderChanged.decodeDelimited = function decodeDelimited(reader) {
            if (!(reader instanceof $Reader))
                reader = new $Reader(reader);
            return this.decode(reader, reader.uint32());
        };

        /**
         * Verifies a FolderChanged message.
         * @function verify
         * @memberof notification.FolderChanged
         * @static
         * @param {Object.<string,*>} message Plain object to verify
         * @returns {string|null} `null` if valid, otherwise the reason why it is not
         */
        FolderChanged.verify = function verify(message) {
            if (typeof message !== "object" || message === null)
                return "object expected";
            let properties = {};
            if (message.outlineDiffJson != null && message.hasOwnProperty("outlineDiffJson"))
                if (!$util.isString(message.outlineDiffJson))
                    return "outlineDiffJson: string expected";
            if (message.folderRid != null && message.hasOwnProperty("folderRid")) {
                properties._folderRid = 1;
                if (!$util.isString(message.folderRid))
                    return "folderRid: string expected";
            }
            return null;
        };

        /**
         * Creates a FolderChanged message from a plain object. Also converts values to their respective internal types.
         * @function fromObject
         * @memberof notification.FolderChanged
         * @static
         * @param {Object.<string,*>} object Plain object
         * @returns {notification.FolderChanged} FolderChanged
         */
        FolderChanged.fromObject = function fromObject(object) {
            if (object instanceof $root.notification.FolderChanged)
                return object;
            let message = new $root.notification.FolderChanged();
            if (object.outlineDiffJson != null)
                message.outlineDiffJson = String(object.outlineDiffJson);
            if (object.folderRid != null)
                message.folderRid = String(object.folderRid);
            return message;
        };

        /**
         * Creates a plain object from a FolderChanged message. Also converts values to other types if specified.
         * @function toObject
         * @memberof notification.FolderChanged
         * @static
         * @param {notification.FolderChanged} message FolderChanged
         * @param {$protobuf.IConversionOptions} [options] Conversion options
         * @returns {Object.<string,*>} Plain object
         */
        FolderChanged.toObject = function toObject(message, options) {
            if (!options)
                options = {};
            let object = {};
            if (options.defaults)
                object.outlineDiffJson = "";
            if (message.outlineDiffJson != null && message.hasOwnProperty("outlineDiffJson"))
                object.outlineDiffJson = message.outlineDiffJson;
            if (message.folderRid != null && message.hasOwnProperty("folderRid")) {
                object.folderRid = message.folderRid;
                if (options.oneofs)
                    object._folderRid = "folderRid";
            }
            return object;
        };

        /**
         * Converts this FolderChanged to JSON.
         * @function toJSON
         * @memberof notification.FolderChanged
         * @instance
         * @returns {Object.<string,*>} JSON object
         */
        FolderChanged.prototype.toJSON = function toJSON() {
            return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
        };

        /**
         * Gets the default type url for FolderChanged
         * @function getTypeUrl
         * @memberof notification.FolderChanged
         * @static
         * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns {string} The default type url
         */
        FolderChanged.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
            if (typeUrlPrefix === undefined) {
                typeUrlPrefix = "type.googleapis.com";
            }
            return typeUrlPrefix + "/notification.FolderChanged";
        };

        return FolderChanged;
    })();

    return notification;
})();

export { $root as default };
