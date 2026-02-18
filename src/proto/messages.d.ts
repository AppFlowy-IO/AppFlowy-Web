import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace messages. */
export namespace messages {

    /** Properties of a Message. */
    interface IMessage {

        /** Message collabMessage */
        collabMessage?: (collab.ICollabMessage|null);

        /** Message notification */
        notification?: (notification.IWorkspaceNotification|null);
    }

    /** All messages send between client/server are wrapped into a `Message`. */
    class Message implements IMessage {

        /**
         * Constructs a new Message.
         * @param [properties] Properties to set
         */
        constructor(properties?: messages.IMessage);

        /** Message collabMessage. */
        public collabMessage?: (collab.ICollabMessage|null);

        /** Message notification. */
        public notification?: (notification.IWorkspaceNotification|null);

        /** Message payload. */
        public payload?: ("collabMessage"|"notification");

        /**
         * Creates a new Message instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Message instance
         */
        public static create(properties?: messages.IMessage): messages.Message;

        /**
         * Encodes the specified Message message. Does not implicitly {@link messages.Message.verify|verify} messages.
         * @param message Message message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: messages.IMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Message message, length delimited. Does not implicitly {@link messages.Message.verify|verify} messages.
         * @param message Message message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: messages.IMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Message message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Message
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): messages.Message;

        /**
         * Decodes a Message message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Message
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): messages.Message;

        /**
         * Verifies a Message message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Message message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Message
         */
        public static fromObject(object: { [k: string]: any }): messages.Message;

        /**
         * Creates a plain object from a Message message. Also converts values to other types if specified.
         * @param message Message
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: messages.Message, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Message to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Message
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace collab. */
export namespace collab {

    /** Properties of a Rid. */
    interface IRid {

        /** Rid timestamp */
        timestamp?: (number|Long|null);

        /** Rid counter */
        counter?: (number|null);
    }

    /**
     * Rid represents Redis stream message Id, which is a unique identifier
     * in scope of individual Redis stream - here workspace scope - assigned
     * to each update stored in Redis.
     *
     * Default: "0-0"
     */
    class Rid implements IRid {

        /**
         * Constructs a new Rid.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.IRid);

        /** Rid timestamp. */
        public timestamp: (number|Long);

        /** Rid counter. */
        public counter: number;

        /**
         * Creates a new Rid instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Rid instance
         */
        public static create(properties?: collab.IRid): collab.Rid;

        /**
         * Encodes the specified Rid message. Does not implicitly {@link collab.Rid.verify|verify} messages.
         * @param message Rid message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.IRid, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Rid message, length delimited. Does not implicitly {@link collab.Rid.verify|verify} messages.
         * @param message Rid message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.IRid, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a Rid message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Rid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.Rid;

        /**
         * Decodes a Rid message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Rid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.Rid;

        /**
         * Verifies a Rid message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a Rid message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Rid
         */
        public static fromObject(object: { [k: string]: any }): collab.Rid;

        /**
         * Creates a plain object from a Rid message. Also converts values to other types if specified.
         * @param message Rid
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.Rid, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Rid to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Rid
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a SyncRequest. */
    interface ISyncRequest {

        /** SyncRequest lastMessageId */
        lastMessageId?: (collab.IRid|null);

        /** SyncRequest stateVector */
        stateVector?: (Uint8Array|null);
    }

    /**
     * SyncRequest message is send by either a server or a client, which informs about the
     * last collab state known to either party.
     *
     * If other side has more recent data, it should send `Update` message in the response.
     * If other side has missing data, it should send its own `SyncRequest` in the response.
     */
    class SyncRequest implements ISyncRequest {

        /**
         * Constructs a new SyncRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.ISyncRequest);

        /** SyncRequest lastMessageId. */
        public lastMessageId?: (collab.IRid|null);

        /** SyncRequest stateVector. */
        public stateVector: Uint8Array;

        /**
         * Creates a new SyncRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns SyncRequest instance
         */
        public static create(properties?: collab.ISyncRequest): collab.SyncRequest;

        /**
         * Encodes the specified SyncRequest message. Does not implicitly {@link collab.SyncRequest.verify|verify} messages.
         * @param message SyncRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.ISyncRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified SyncRequest message, length delimited. Does not implicitly {@link collab.SyncRequest.verify|verify} messages.
         * @param message SyncRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.ISyncRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a SyncRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns SyncRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.SyncRequest;

        /**
         * Decodes a SyncRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns SyncRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.SyncRequest;

        /**
         * Verifies a SyncRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a SyncRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns SyncRequest
         */
        public static fromObject(object: { [k: string]: any }): collab.SyncRequest;

        /**
         * Creates a plain object from a SyncRequest message. Also converts values to other types if specified.
         * @param message SyncRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.SyncRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this SyncRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for SyncRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an Update. */
    interface IUpdate {

        /** Update messageId */
        messageId?: (collab.IRid|null);

        /** Update flags */
        flags?: (number|null);

        /** Update payload */
        payload?: (Uint8Array|null);
    }

    /**
     * Update message is send either in response to `SyncRequest` or independently by
     * the client/server. It contains the Yjs doc update that can represent incremental
     * changes made over corresponding collab, or full document state.
     */
    class Update implements IUpdate {

        /**
         * Constructs a new Update.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.IUpdate);

        /** Update messageId. */
        public messageId?: (collab.IRid|null);

        /** Update flags. */
        public flags: number;

        /** Update payload. */
        public payload: Uint8Array;

        /**
         * Creates a new Update instance using the specified properties.
         * @param [properties] Properties to set
         * @returns Update instance
         */
        public static create(properties?: collab.IUpdate): collab.Update;

        /**
         * Encodes the specified Update message. Does not implicitly {@link collab.Update.verify|verify} messages.
         * @param message Update message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.IUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified Update message, length delimited. Does not implicitly {@link collab.Update.verify|verify} messages.
         * @param message Update message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.IUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an Update message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns Update
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.Update;

        /**
         * Decodes an Update message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns Update
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.Update;

        /**
         * Verifies an Update message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an Update message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns Update
         */
        public static fromObject(object: { [k: string]: any }): collab.Update;

        /**
         * Creates a plain object from an Update message. Also converts values to other types if specified.
         * @param message Update
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.Update, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this Update to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for Update
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an AwarenessUpdate. */
    interface IAwarenessUpdate {

        /** AwarenessUpdate payload */
        payload?: (Uint8Array|null);
    }

    /**
     * AwarenessUpdate message is send to inform about the latest changes in the
     * Yjs doc awareness state.
     */
    class AwarenessUpdate implements IAwarenessUpdate {

        /**
         * Constructs a new AwarenessUpdate.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.IAwarenessUpdate);

        /** AwarenessUpdate payload. */
        public payload: Uint8Array;

        /**
         * Creates a new AwarenessUpdate instance using the specified properties.
         * @param [properties] Properties to set
         * @returns AwarenessUpdate instance
         */
        public static create(properties?: collab.IAwarenessUpdate): collab.AwarenessUpdate;

        /**
         * Encodes the specified AwarenessUpdate message. Does not implicitly {@link collab.AwarenessUpdate.verify|verify} messages.
         * @param message AwarenessUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.IAwarenessUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified AwarenessUpdate message, length delimited. Does not implicitly {@link collab.AwarenessUpdate.verify|verify} messages.
         * @param message AwarenessUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.IAwarenessUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an AwarenessUpdate message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns AwarenessUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.AwarenessUpdate;

        /**
         * Decodes an AwarenessUpdate message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns AwarenessUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.AwarenessUpdate;

        /**
         * Verifies an AwarenessUpdate message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an AwarenessUpdate message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns AwarenessUpdate
         */
        public static fromObject(object: { [k: string]: any }): collab.AwarenessUpdate;

        /**
         * Creates a plain object from an AwarenessUpdate message. Also converts values to other types if specified.
         * @param message AwarenessUpdate
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.AwarenessUpdate, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this AwarenessUpdate to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for AwarenessUpdate
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an AccessChanged. */
    interface IAccessChanged {

        /** AccessChanged canRead */
        canRead?: (boolean|null);

        /** AccessChanged canWrite */
        canWrite?: (boolean|null);

        /** AccessChanged reason */
        reason?: (number|null);
    }

    /**
     * AccessChanged message is sent only by the server when we recognise, that
     * connected client has lost the access to a corresponding collab.
     */
    class AccessChanged implements IAccessChanged {

        /**
         * Constructs a new AccessChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.IAccessChanged);

        /** AccessChanged canRead. */
        public canRead: boolean;

        /** AccessChanged canWrite. */
        public canWrite: boolean;

        /** AccessChanged reason. */
        public reason: number;

        /**
         * Creates a new AccessChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns AccessChanged instance
         */
        public static create(properties?: collab.IAccessChanged): collab.AccessChanged;

        /**
         * Encodes the specified AccessChanged message. Does not implicitly {@link collab.AccessChanged.verify|verify} messages.
         * @param message AccessChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.IAccessChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified AccessChanged message, length delimited. Does not implicitly {@link collab.AccessChanged.verify|verify} messages.
         * @param message AccessChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.IAccessChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an AccessChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns AccessChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.AccessChanged;

        /**
         * Decodes an AccessChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns AccessChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.AccessChanged;

        /**
         * Verifies an AccessChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an AccessChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns AccessChanged
         */
        public static fromObject(object: { [k: string]: any }): collab.AccessChanged;

        /**
         * Creates a plain object from an AccessChanged message. Also converts values to other types if specified.
         * @param message AccessChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.AccessChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this AccessChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for AccessChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CollabMessage. */
    interface ICollabMessage {

        /** CollabMessage objectId */
        objectId?: (string|null);

        /** CollabMessage collabType */
        collabType?: (number|null);

        /** CollabMessage syncRequest */
        syncRequest?: (collab.ISyncRequest|null);

        /** CollabMessage update */
        update?: (collab.IUpdate|null);

        /** CollabMessage awarenessUpdate */
        awarenessUpdate?: (collab.IAwarenessUpdate|null);

        /** CollabMessage accessChanged */
        accessChanged?: (collab.IAccessChanged|null);
    }

    /** Represents a CollabMessage. */
    class CollabMessage implements ICollabMessage {

        /**
         * Constructs a new CollabMessage.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.ICollabMessage);

        /** CollabMessage objectId. */
        public objectId: string;

        /** CollabMessage collabType. */
        public collabType: number;

        /** CollabMessage syncRequest. */
        public syncRequest?: (collab.ISyncRequest|null);

        /** CollabMessage update. */
        public update?: (collab.IUpdate|null);

        /** CollabMessage awarenessUpdate. */
        public awarenessUpdate?: (collab.IAwarenessUpdate|null);

        /** CollabMessage accessChanged. */
        public accessChanged?: (collab.IAccessChanged|null);

        /** CollabMessage data. */
        public data?: ("syncRequest"|"update"|"awarenessUpdate"|"accessChanged");

        /**
         * Creates a new CollabMessage instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CollabMessage instance
         */
        public static create(properties?: collab.ICollabMessage): collab.CollabMessage;

        /**
         * Encodes the specified CollabMessage message. Does not implicitly {@link collab.CollabMessage.verify|verify} messages.
         * @param message CollabMessage message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.ICollabMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CollabMessage message, length delimited. Does not implicitly {@link collab.CollabMessage.verify|verify} messages.
         * @param message CollabMessage message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.ICollabMessage, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CollabMessage message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CollabMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.CollabMessage;

        /**
         * Decodes a CollabMessage message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CollabMessage
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.CollabMessage;

        /**
         * Verifies a CollabMessage message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CollabMessage message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CollabMessage
         */
        public static fromObject(object: { [k: string]: any }): collab.CollabMessage;

        /**
         * Creates a plain object from a CollabMessage message. Also converts values to other types if specified.
         * @param message CollabMessage
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.CollabMessage, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CollabMessage to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CollabMessage
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Compression type for collab payloads. */
    enum PayloadCompressionType {
        COMPRESSION_NONE = 0,
        COMPRESSION_ZSTD = 1,
        COMPRESSION_GZIP = 2
    }

    /** Properties of a CollabDocStateParams. */
    interface ICollabDocStateParams {

        /** CollabDocStateParams objectId */
        objectId?: (string|null);

        /** CollabDocStateParams collabType */
        collabType?: (number|null);

        /** CollabDocStateParams compression */
        compression?: (collab.PayloadCompressionType|null);

        /** CollabDocStateParams sv */
        sv?: (Uint8Array|null);

        /** CollabDocStateParams docState */
        docState?: (Uint8Array|null);
    }

    /** Parameters for a single collab document state in batch sync. */
    class CollabDocStateParams implements ICollabDocStateParams {

        /**
         * Constructs a new CollabDocStateParams.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.ICollabDocStateParams);

        /** CollabDocStateParams objectId. */
        public objectId: string;

        /** CollabDocStateParams collabType. */
        public collabType: number;

        /** CollabDocStateParams compression. */
        public compression: collab.PayloadCompressionType;

        /** CollabDocStateParams sv. */
        public sv: Uint8Array;

        /** CollabDocStateParams docState. */
        public docState: Uint8Array;

        /**
         * Creates a new CollabDocStateParams instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CollabDocStateParams instance
         */
        public static create(properties?: collab.ICollabDocStateParams): collab.CollabDocStateParams;

        /**
         * Encodes the specified CollabDocStateParams message. Does not implicitly {@link collab.CollabDocStateParams.verify|verify} messages.
         * @param message CollabDocStateParams message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.ICollabDocStateParams, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CollabDocStateParams message, length delimited. Does not implicitly {@link collab.CollabDocStateParams.verify|verify} messages.
         * @param message CollabDocStateParams message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.ICollabDocStateParams, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CollabDocStateParams message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CollabDocStateParams
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.CollabDocStateParams;

        /**
         * Decodes a CollabDocStateParams message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CollabDocStateParams
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.CollabDocStateParams;

        /**
         * Verifies a CollabDocStateParams message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CollabDocStateParams message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CollabDocStateParams
         */
        public static fromObject(object: { [k: string]: any }): collab.CollabDocStateParams;

        /**
         * Creates a plain object from a CollabDocStateParams message. Also converts values to other types if specified.
         * @param message CollabDocStateParams
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.CollabDocStateParams, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CollabDocStateParams to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CollabDocStateParams
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CollabBatchSyncRequest. */
    interface ICollabBatchSyncRequest {

        /** CollabBatchSyncRequest items */
        items?: (collab.ICollabDocStateParams[]|null);

        /** CollabBatchSyncRequest responseCompression */
        responseCompression?: (collab.PayloadCompressionType|null);
    }

    /**
     * Request to sync multiple collab documents in a batch.
     * Used before operations like duplicate to ensure server has latest state.
     */
    class CollabBatchSyncRequest implements ICollabBatchSyncRequest {

        /**
         * Constructs a new CollabBatchSyncRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.ICollabBatchSyncRequest);

        /** CollabBatchSyncRequest items. */
        public items: collab.ICollabDocStateParams[];

        /** CollabBatchSyncRequest responseCompression. */
        public responseCompression: collab.PayloadCompressionType;

        /**
         * Creates a new CollabBatchSyncRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CollabBatchSyncRequest instance
         */
        public static create(properties?: collab.ICollabBatchSyncRequest): collab.CollabBatchSyncRequest;

        /**
         * Encodes the specified CollabBatchSyncRequest message. Does not implicitly {@link collab.CollabBatchSyncRequest.verify|verify} messages.
         * @param message CollabBatchSyncRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.ICollabBatchSyncRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CollabBatchSyncRequest message, length delimited. Does not implicitly {@link collab.CollabBatchSyncRequest.verify|verify} messages.
         * @param message CollabBatchSyncRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.ICollabBatchSyncRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CollabBatchSyncRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CollabBatchSyncRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.CollabBatchSyncRequest;

        /**
         * Decodes a CollabBatchSyncRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CollabBatchSyncRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.CollabBatchSyncRequest;

        /**
         * Verifies a CollabBatchSyncRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CollabBatchSyncRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CollabBatchSyncRequest
         */
        public static fromObject(object: { [k: string]: any }): collab.CollabBatchSyncRequest;

        /**
         * Creates a plain object from a CollabBatchSyncRequest message. Also converts values to other types if specified.
         * @param message CollabBatchSyncRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.CollabBatchSyncRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CollabBatchSyncRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CollabBatchSyncRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CollabBatchSyncResult. */
    interface ICollabBatchSyncResult {

        /** CollabBatchSyncResult objectId */
        objectId?: (string|null);

        /** CollabBatchSyncResult collabType */
        collabType?: (number|null);

        /** CollabBatchSyncResult compression */
        compression?: (collab.PayloadCompressionType|null);

        /** CollabBatchSyncResult missingUpdate */
        missingUpdate?: (Uint8Array|null);

        /** CollabBatchSyncResult error */
        error?: (string|null);

        /** CollabBatchSyncResult serverStateVector */
        serverStateVector?: (Uint8Array|null);
    }

    /** Result for a single collab in batch sync response. */
    class CollabBatchSyncResult implements ICollabBatchSyncResult {

        /**
         * Constructs a new CollabBatchSyncResult.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.ICollabBatchSyncResult);

        /** CollabBatchSyncResult objectId. */
        public objectId: string;

        /** CollabBatchSyncResult collabType. */
        public collabType: number;

        /** CollabBatchSyncResult compression. */
        public compression: collab.PayloadCompressionType;

        /** CollabBatchSyncResult missingUpdate. */
        public missingUpdate: Uint8Array;

        /** CollabBatchSyncResult error. */
        public error: string;

        /** CollabBatchSyncResult serverStateVector. */
        public serverStateVector: Uint8Array;

        /**
         * Creates a new CollabBatchSyncResult instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CollabBatchSyncResult instance
         */
        public static create(properties?: collab.ICollabBatchSyncResult): collab.CollabBatchSyncResult;

        /**
         * Encodes the specified CollabBatchSyncResult message. Does not implicitly {@link collab.CollabBatchSyncResult.verify|verify} messages.
         * @param message CollabBatchSyncResult message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.ICollabBatchSyncResult, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CollabBatchSyncResult message, length delimited. Does not implicitly {@link collab.CollabBatchSyncResult.verify|verify} messages.
         * @param message CollabBatchSyncResult message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.ICollabBatchSyncResult, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CollabBatchSyncResult message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CollabBatchSyncResult
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.CollabBatchSyncResult;

        /**
         * Decodes a CollabBatchSyncResult message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CollabBatchSyncResult
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.CollabBatchSyncResult;

        /**
         * Verifies a CollabBatchSyncResult message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CollabBatchSyncResult message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CollabBatchSyncResult
         */
        public static fromObject(object: { [k: string]: any }): collab.CollabBatchSyncResult;

        /**
         * Creates a plain object from a CollabBatchSyncResult message. Also converts values to other types if specified.
         * @param message CollabBatchSyncResult
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.CollabBatchSyncResult, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CollabBatchSyncResult to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CollabBatchSyncResult
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CollabBatchSyncResponse. */
    interface ICollabBatchSyncResponse {

        /** CollabBatchSyncResponse results */
        results?: (collab.ICollabBatchSyncResult[]|null);

        /** CollabBatchSyncResponse responseCompression */
        responseCompression?: (collab.PayloadCompressionType|null);
    }

    /** Response from batch sync containing results for each collab. */
    class CollabBatchSyncResponse implements ICollabBatchSyncResponse {

        /**
         * Constructs a new CollabBatchSyncResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: collab.ICollabBatchSyncResponse);

        /** CollabBatchSyncResponse results. */
        public results: collab.ICollabBatchSyncResult[];

        /** CollabBatchSyncResponse responseCompression. */
        public responseCompression: collab.PayloadCompressionType;

        /**
         * Creates a new CollabBatchSyncResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CollabBatchSyncResponse instance
         */
        public static create(properties?: collab.ICollabBatchSyncResponse): collab.CollabBatchSyncResponse;

        /**
         * Encodes the specified CollabBatchSyncResponse message. Does not implicitly {@link collab.CollabBatchSyncResponse.verify|verify} messages.
         * @param message CollabBatchSyncResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: collab.ICollabBatchSyncResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CollabBatchSyncResponse message, length delimited. Does not implicitly {@link collab.CollabBatchSyncResponse.verify|verify} messages.
         * @param message CollabBatchSyncResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: collab.ICollabBatchSyncResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CollabBatchSyncResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CollabBatchSyncResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): collab.CollabBatchSyncResponse;

        /**
         * Decodes a CollabBatchSyncResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CollabBatchSyncResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): collab.CollabBatchSyncResponse;

        /**
         * Verifies a CollabBatchSyncResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CollabBatchSyncResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CollabBatchSyncResponse
         */
        public static fromObject(object: { [k: string]: any }): collab.CollabBatchSyncResponse;

        /**
         * Creates a plain object from a CollabBatchSyncResponse message. Also converts values to other types if specified.
         * @param message CollabBatchSyncResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: collab.CollabBatchSyncResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CollabBatchSyncResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CollabBatchSyncResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}

/** Namespace notification. */
export namespace notification {

    /** Properties of a WorkspaceNotification. */
    interface IWorkspaceNotification {

        /** WorkspaceNotification profileChange */
        profileChange?: (notification.IUserProfileChange|null);

        /** WorkspaceNotification permissionChanged */
        permissionChanged?: (notification.IPermissionChanged|null);

        /** WorkspaceNotification sectionChanged */
        sectionChanged?: (notification.ISectionChanged|null);

        /** WorkspaceNotification shareViewsChanged */
        shareViewsChanged?: (notification.IShareViewsChanged|null);

        /** WorkspaceNotification mentionablePersonListChanged */
        mentionablePersonListChanged?: (notification.IMentionablePersonListChanged|null);

        /** WorkspaceNotification serverLimit */
        serverLimit?: (notification.IServerLimit|null);

        /** WorkspaceNotification workspaceMemberProfileChanged */
        workspaceMemberProfileChanged?: (notification.IWorkspaceMemberProfileChanged|null);

        /** WorkspaceNotification folderChanged */
        folderChanged?: (notification.IFolderChanged|null);

        /** WorkspaceNotification folderViewChanged */
        folderViewChanged?: (notification.IFolderViewChanged|null);
    }

    /** Represents a WorkspaceNotification. */
    class WorkspaceNotification implements IWorkspaceNotification {

        /**
         * Constructs a new WorkspaceNotification.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IWorkspaceNotification);

        /** WorkspaceNotification profileChange. */
        public profileChange?: (notification.IUserProfileChange|null);

        /** WorkspaceNotification permissionChanged. */
        public permissionChanged?: (notification.IPermissionChanged|null);

        /** WorkspaceNotification sectionChanged. */
        public sectionChanged?: (notification.ISectionChanged|null);

        /** WorkspaceNotification shareViewsChanged. */
        public shareViewsChanged?: (notification.IShareViewsChanged|null);

        /** WorkspaceNotification mentionablePersonListChanged. */
        public mentionablePersonListChanged?: (notification.IMentionablePersonListChanged|null);

        /** WorkspaceNotification serverLimit. */
        public serverLimit?: (notification.IServerLimit|null);

        /** WorkspaceNotification workspaceMemberProfileChanged. */
        public workspaceMemberProfileChanged?: (notification.IWorkspaceMemberProfileChanged|null);

        /** WorkspaceNotification folderChanged. */
        public folderChanged?: (notification.IFolderChanged|null);

        /** WorkspaceNotification folderViewChanged. */
        public folderViewChanged?: (notification.IFolderViewChanged|null);

        /** WorkspaceNotification payload. */
        public payload?: ("profileChange"|"permissionChanged"|"sectionChanged"|"shareViewsChanged"|"mentionablePersonListChanged"|"serverLimit"|"workspaceMemberProfileChanged"|"folderChanged"|"folderViewChanged");

        /**
         * Creates a new WorkspaceNotification instance using the specified properties.
         * @param [properties] Properties to set
         * @returns WorkspaceNotification instance
         */
        public static create(properties?: notification.IWorkspaceNotification): notification.WorkspaceNotification;

        /**
         * Encodes the specified WorkspaceNotification message. Does not implicitly {@link notification.WorkspaceNotification.verify|verify} messages.
         * @param message WorkspaceNotification message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IWorkspaceNotification, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified WorkspaceNotification message, length delimited. Does not implicitly {@link notification.WorkspaceNotification.verify|verify} messages.
         * @param message WorkspaceNotification message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IWorkspaceNotification, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a WorkspaceNotification message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns WorkspaceNotification
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.WorkspaceNotification;

        /**
         * Decodes a WorkspaceNotification message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns WorkspaceNotification
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.WorkspaceNotification;

        /**
         * Verifies a WorkspaceNotification message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a WorkspaceNotification message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns WorkspaceNotification
         */
        public static fromObject(object: { [k: string]: any }): notification.WorkspaceNotification;

        /**
         * Creates a plain object from a WorkspaceNotification message. Also converts values to other types if specified.
         * @param message WorkspaceNotification
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.WorkspaceNotification, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this WorkspaceNotification to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for WorkspaceNotification
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a UserProfileChange. */
    interface IUserProfileChange {

        /** UserProfileChange uid */
        uid?: (number|Long|null);

        /** UserProfileChange name */
        name?: (string|null);

        /** UserProfileChange email */
        email?: (string|null);
    }

    /** Represents a UserProfileChange. */
    class UserProfileChange implements IUserProfileChange {

        /**
         * Constructs a new UserProfileChange.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IUserProfileChange);

        /** UserProfileChange uid. */
        public uid: (number|Long);

        /** UserProfileChange name. */
        public name?: (string|null);

        /** UserProfileChange email. */
        public email?: (string|null);

        /** UserProfileChange _name. */
        public _name?: "name";

        /** UserProfileChange _email. */
        public _email?: "email";

        /**
         * Creates a new UserProfileChange instance using the specified properties.
         * @param [properties] Properties to set
         * @returns UserProfileChange instance
         */
        public static create(properties?: notification.IUserProfileChange): notification.UserProfileChange;

        /**
         * Encodes the specified UserProfileChange message. Does not implicitly {@link notification.UserProfileChange.verify|verify} messages.
         * @param message UserProfileChange message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IUserProfileChange, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified UserProfileChange message, length delimited. Does not implicitly {@link notification.UserProfileChange.verify|verify} messages.
         * @param message UserProfileChange message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IUserProfileChange, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a UserProfileChange message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns UserProfileChange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.UserProfileChange;

        /**
         * Decodes a UserProfileChange message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns UserProfileChange
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.UserProfileChange;

        /**
         * Verifies a UserProfileChange message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a UserProfileChange message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns UserProfileChange
         */
        public static fromObject(object: { [k: string]: any }): notification.UserProfileChange;

        /**
         * Creates a plain object from a UserProfileChange message. Also converts values to other types if specified.
         * @param message UserProfileChange
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.UserProfileChange, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this UserProfileChange to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for UserProfileChange
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a PermissionChanged. */
    interface IPermissionChanged {

        /** PermissionChanged objectId */
        objectId?: (string|null);

        /** PermissionChanged reason */
        reason?: (number|null);
    }

    /** Represents a PermissionChanged. */
    class PermissionChanged implements IPermissionChanged {

        /**
         * Constructs a new PermissionChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IPermissionChanged);

        /** PermissionChanged objectId. */
        public objectId: string;

        /** PermissionChanged reason. */
        public reason: number;

        /**
         * Creates a new PermissionChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns PermissionChanged instance
         */
        public static create(properties?: notification.IPermissionChanged): notification.PermissionChanged;

        /**
         * Encodes the specified PermissionChanged message. Does not implicitly {@link notification.PermissionChanged.verify|verify} messages.
         * @param message PermissionChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IPermissionChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified PermissionChanged message, length delimited. Does not implicitly {@link notification.PermissionChanged.verify|verify} messages.
         * @param message PermissionChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IPermissionChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a PermissionChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns PermissionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.PermissionChanged;

        /**
         * Decodes a PermissionChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns PermissionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.PermissionChanged;

        /**
         * Verifies a PermissionChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a PermissionChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns PermissionChanged
         */
        public static fromObject(object: { [k: string]: any }): notification.PermissionChanged;

        /**
         * Creates a plain object from a PermissionChanged message. Also converts values to other types if specified.
         * @param message PermissionChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.PermissionChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this PermissionChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for PermissionChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a SectionChanged. */
    interface ISectionChanged {

        /** SectionChanged data */
        data?: (string|null);
    }

    /** Represents a SectionChanged. */
    class SectionChanged implements ISectionChanged {

        /**
         * Constructs a new SectionChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.ISectionChanged);

        /** SectionChanged data. */
        public data: string;

        /**
         * Creates a new SectionChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns SectionChanged instance
         */
        public static create(properties?: notification.ISectionChanged): notification.SectionChanged;

        /**
         * Encodes the specified SectionChanged message. Does not implicitly {@link notification.SectionChanged.verify|verify} messages.
         * @param message SectionChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.ISectionChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified SectionChanged message, length delimited. Does not implicitly {@link notification.SectionChanged.verify|verify} messages.
         * @param message SectionChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.ISectionChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a SectionChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns SectionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.SectionChanged;

        /**
         * Decodes a SectionChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns SectionChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.SectionChanged;

        /**
         * Verifies a SectionChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a SectionChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns SectionChanged
         */
        public static fromObject(object: { [k: string]: any }): notification.SectionChanged;

        /**
         * Creates a plain object from a SectionChanged message. Also converts values to other types if specified.
         * @param message SectionChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.SectionChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this SectionChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for SectionChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a MentionablePersonListChanged. */
    interface IMentionablePersonListChanged {

        /** MentionablePersonListChanged updateMemberRole */
        updateMemberRole?: (notification.IUpdateMemberRole|null);

        /** MentionablePersonListChanged pageMention */
        pageMention?: (notification.IPageMention|null);

        /** MentionablePersonListChanged newMember */
        newMember?: (notification.INewMember|null);

        /** MentionablePersonListChanged removedMember */
        removedMember?: (notification.IRemovedMember|null);
    }

    /** Represents a MentionablePersonListChanged. */
    class MentionablePersonListChanged implements IMentionablePersonListChanged {

        /**
         * Constructs a new MentionablePersonListChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IMentionablePersonListChanged);

        /** MentionablePersonListChanged updateMemberRole. */
        public updateMemberRole?: (notification.IUpdateMemberRole|null);

        /** MentionablePersonListChanged pageMention. */
        public pageMention?: (notification.IPageMention|null);

        /** MentionablePersonListChanged newMember. */
        public newMember?: (notification.INewMember|null);

        /** MentionablePersonListChanged removedMember. */
        public removedMember?: (notification.IRemovedMember|null);

        /** MentionablePersonListChanged payload. */
        public payload?: ("updateMemberRole"|"pageMention"|"newMember"|"removedMember");

        /**
         * Creates a new MentionablePersonListChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns MentionablePersonListChanged instance
         */
        public static create(properties?: notification.IMentionablePersonListChanged): notification.MentionablePersonListChanged;

        /**
         * Encodes the specified MentionablePersonListChanged message. Does not implicitly {@link notification.MentionablePersonListChanged.verify|verify} messages.
         * @param message MentionablePersonListChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IMentionablePersonListChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified MentionablePersonListChanged message, length delimited. Does not implicitly {@link notification.MentionablePersonListChanged.verify|verify} messages.
         * @param message MentionablePersonListChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IMentionablePersonListChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a MentionablePersonListChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns MentionablePersonListChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.MentionablePersonListChanged;

        /**
         * Decodes a MentionablePersonListChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns MentionablePersonListChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.MentionablePersonListChanged;

        /**
         * Verifies a MentionablePersonListChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a MentionablePersonListChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns MentionablePersonListChanged
         */
        public static fromObject(object: { [k: string]: any }): notification.MentionablePersonListChanged;

        /**
         * Creates a plain object from a MentionablePersonListChanged message. Also converts values to other types if specified.
         * @param message MentionablePersonListChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.MentionablePersonListChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this MentionablePersonListChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for MentionablePersonListChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a NewMember. */
    interface INewMember {

        /** NewMember userUuid */
        userUuid?: (string|null);
    }

    /** Represents a NewMember. */
    class NewMember implements INewMember {

        /**
         * Constructs a new NewMember.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.INewMember);

        /** NewMember userUuid. */
        public userUuid: string;

        /**
         * Creates a new NewMember instance using the specified properties.
         * @param [properties] Properties to set
         * @returns NewMember instance
         */
        public static create(properties?: notification.INewMember): notification.NewMember;

        /**
         * Encodes the specified NewMember message. Does not implicitly {@link notification.NewMember.verify|verify} messages.
         * @param message NewMember message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.INewMember, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified NewMember message, length delimited. Does not implicitly {@link notification.NewMember.verify|verify} messages.
         * @param message NewMember message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.INewMember, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a NewMember message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns NewMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.NewMember;

        /**
         * Decodes a NewMember message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns NewMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.NewMember;

        /**
         * Verifies a NewMember message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a NewMember message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns NewMember
         */
        public static fromObject(object: { [k: string]: any }): notification.NewMember;

        /**
         * Creates a plain object from a NewMember message. Also converts values to other types if specified.
         * @param message NewMember
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.NewMember, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this NewMember to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for NewMember
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a RemovedMember. */
    interface IRemovedMember {

        /** RemovedMember userUuid */
        userUuid?: (string|null);
    }

    /** Represents a RemovedMember. */
    class RemovedMember implements IRemovedMember {

        /**
         * Constructs a new RemovedMember.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IRemovedMember);

        /** RemovedMember userUuid. */
        public userUuid: string;

        /**
         * Creates a new RemovedMember instance using the specified properties.
         * @param [properties] Properties to set
         * @returns RemovedMember instance
         */
        public static create(properties?: notification.IRemovedMember): notification.RemovedMember;

        /**
         * Encodes the specified RemovedMember message. Does not implicitly {@link notification.RemovedMember.verify|verify} messages.
         * @param message RemovedMember message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IRemovedMember, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified RemovedMember message, length delimited. Does not implicitly {@link notification.RemovedMember.verify|verify} messages.
         * @param message RemovedMember message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IRemovedMember, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a RemovedMember message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns RemovedMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.RemovedMember;

        /**
         * Decodes a RemovedMember message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns RemovedMember
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.RemovedMember;

        /**
         * Verifies a RemovedMember message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a RemovedMember message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns RemovedMember
         */
        public static fromObject(object: { [k: string]: any }): notification.RemovedMember;

        /**
         * Creates a plain object from a RemovedMember message. Also converts values to other types if specified.
         * @param message RemovedMember
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.RemovedMember, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this RemovedMember to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for RemovedMember
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of an UpdateMemberRole. */
    interface IUpdateMemberRole {

        /** UpdateMemberRole userUuid */
        userUuid?: (string|null);

        /** UpdateMemberRole email */
        email?: (string|null);

        /** UpdateMemberRole role */
        role?: (number|null);
    }

    /** Represents an UpdateMemberRole. */
    class UpdateMemberRole implements IUpdateMemberRole {

        /**
         * Constructs a new UpdateMemberRole.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IUpdateMemberRole);

        /** UpdateMemberRole userUuid. */
        public userUuid: string;

        /** UpdateMemberRole email. */
        public email: string;

        /** UpdateMemberRole role. */
        public role: number;

        /**
         * Creates a new UpdateMemberRole instance using the specified properties.
         * @param [properties] Properties to set
         * @returns UpdateMemberRole instance
         */
        public static create(properties?: notification.IUpdateMemberRole): notification.UpdateMemberRole;

        /**
         * Encodes the specified UpdateMemberRole message. Does not implicitly {@link notification.UpdateMemberRole.verify|verify} messages.
         * @param message UpdateMemberRole message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IUpdateMemberRole, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified UpdateMemberRole message, length delimited. Does not implicitly {@link notification.UpdateMemberRole.verify|verify} messages.
         * @param message UpdateMemberRole message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IUpdateMemberRole, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes an UpdateMemberRole message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns UpdateMemberRole
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.UpdateMemberRole;

        /**
         * Decodes an UpdateMemberRole message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns UpdateMemberRole
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.UpdateMemberRole;

        /**
         * Verifies an UpdateMemberRole message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates an UpdateMemberRole message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns UpdateMemberRole
         */
        public static fromObject(object: { [k: string]: any }): notification.UpdateMemberRole;

        /**
         * Creates a plain object from an UpdateMemberRole message. Also converts values to other types if specified.
         * @param message UpdateMemberRole
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.UpdateMemberRole, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this UpdateMemberRole to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for UpdateMemberRole
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a PageMention. */
    interface IPageMention {

        /** PageMention userUuid */
        userUuid?: (string|null);

        /** PageMention viewId */
        viewId?: (string|null);

        /** PageMention mentionedAt */
        mentionedAt?: (number|Long|null);
    }

    /** Represents a PageMention. */
    class PageMention implements IPageMention {

        /**
         * Constructs a new PageMention.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IPageMention);

        /** PageMention userUuid. */
        public userUuid: string;

        /** PageMention viewId. */
        public viewId: string;

        /** PageMention mentionedAt. */
        public mentionedAt: (number|Long);

        /**
         * Creates a new PageMention instance using the specified properties.
         * @param [properties] Properties to set
         * @returns PageMention instance
         */
        public static create(properties?: notification.IPageMention): notification.PageMention;

        /**
         * Encodes the specified PageMention message. Does not implicitly {@link notification.PageMention.verify|verify} messages.
         * @param message PageMention message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IPageMention, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified PageMention message, length delimited. Does not implicitly {@link notification.PageMention.verify|verify} messages.
         * @param message PageMention message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IPageMention, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a PageMention message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns PageMention
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.PageMention;

        /**
         * Decodes a PageMention message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns PageMention
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.PageMention;

        /**
         * Verifies a PageMention message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a PageMention message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns PageMention
         */
        public static fromObject(object: { [k: string]: any }): notification.PageMention;

        /**
         * Creates a plain object from a PageMention message. Also converts values to other types if specified.
         * @param message PageMention
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.PageMention, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this PageMention to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for PageMention
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ShareViewsChanged. */
    interface IShareViewsChanged {

        /** ShareViewsChanged viewId */
        viewId?: (string|null);

        /** ShareViewsChanged emails */
        emails?: (string[]|null);
    }

    /** Represents a ShareViewsChanged. */
    class ShareViewsChanged implements IShareViewsChanged {

        /**
         * Constructs a new ShareViewsChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IShareViewsChanged);

        /** ShareViewsChanged viewId. */
        public viewId: string;

        /** ShareViewsChanged emails. */
        public emails: string[];

        /**
         * Creates a new ShareViewsChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ShareViewsChanged instance
         */
        public static create(properties?: notification.IShareViewsChanged): notification.ShareViewsChanged;

        /**
         * Encodes the specified ShareViewsChanged message. Does not implicitly {@link notification.ShareViewsChanged.verify|verify} messages.
         * @param message ShareViewsChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IShareViewsChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ShareViewsChanged message, length delimited. Does not implicitly {@link notification.ShareViewsChanged.verify|verify} messages.
         * @param message ShareViewsChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IShareViewsChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ShareViewsChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ShareViewsChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.ShareViewsChanged;

        /**
         * Decodes a ShareViewsChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ShareViewsChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.ShareViewsChanged;

        /**
         * Verifies a ShareViewsChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ShareViewsChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ShareViewsChanged
         */
        public static fromObject(object: { [k: string]: any }): notification.ShareViewsChanged;

        /**
         * Creates a plain object from a ShareViewsChanged message. Also converts values to other types if specified.
         * @param message ShareViewsChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.ShareViewsChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ShareViewsChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ShareViewsChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ServerLimit. */
    interface IServerLimit {

        /** ServerLimit features */
        features?: (number[]|null);

        /** ServerLimit maxUsers */
        maxUsers?: (number|Long|null);

        /** ServerLimit maxGuests */
        maxGuests?: (number|Long|null);
    }

    /** Represents a ServerLimit. */
    class ServerLimit implements IServerLimit {

        /**
         * Constructs a new ServerLimit.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IServerLimit);

        /** ServerLimit features. */
        public features: number[];

        /** ServerLimit maxUsers. */
        public maxUsers: (number|Long);

        /** ServerLimit maxGuests. */
        public maxGuests: (number|Long);

        /**
         * Creates a new ServerLimit instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ServerLimit instance
         */
        public static create(properties?: notification.IServerLimit): notification.ServerLimit;

        /**
         * Encodes the specified ServerLimit message. Does not implicitly {@link notification.ServerLimit.verify|verify} messages.
         * @param message ServerLimit message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IServerLimit, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ServerLimit message, length delimited. Does not implicitly {@link notification.ServerLimit.verify|verify} messages.
         * @param message ServerLimit message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IServerLimit, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ServerLimit message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ServerLimit
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.ServerLimit;

        /**
         * Decodes a ServerLimit message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ServerLimit
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.ServerLimit;

        /**
         * Verifies a ServerLimit message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ServerLimit message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ServerLimit
         */
        public static fromObject(object: { [k: string]: any }): notification.ServerLimit;

        /**
         * Creates a plain object from a ServerLimit message. Also converts values to other types if specified.
         * @param message ServerLimit
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.ServerLimit, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ServerLimit to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ServerLimit
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a WorkspaceMemberProfileChanged. */
    interface IWorkspaceMemberProfileChanged {

        /** WorkspaceMemberProfileChanged userUuid */
        userUuid?: (string|null);

        /** WorkspaceMemberProfileChanged name */
        name?: (string|null);

        /** WorkspaceMemberProfileChanged avatarUrl */
        avatarUrl?: (string|null);

        /** WorkspaceMemberProfileChanged coverImageUrl */
        coverImageUrl?: (string|null);

        /** WorkspaceMemberProfileChanged customImageUrl */
        customImageUrl?: (string|null);

        /** WorkspaceMemberProfileChanged description */
        description?: (string|null);
    }

    /** Represents a WorkspaceMemberProfileChanged. */
    class WorkspaceMemberProfileChanged implements IWorkspaceMemberProfileChanged {

        /**
         * Constructs a new WorkspaceMemberProfileChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IWorkspaceMemberProfileChanged);

        /** WorkspaceMemberProfileChanged userUuid. */
        public userUuid: string;

        /** WorkspaceMemberProfileChanged name. */
        public name: string;

        /** WorkspaceMemberProfileChanged avatarUrl. */
        public avatarUrl?: (string|null);

        /** WorkspaceMemberProfileChanged coverImageUrl. */
        public coverImageUrl?: (string|null);

        /** WorkspaceMemberProfileChanged customImageUrl. */
        public customImageUrl?: (string|null);

        /** WorkspaceMemberProfileChanged description. */
        public description?: (string|null);

        /** WorkspaceMemberProfileChanged _avatarUrl. */
        public _avatarUrl?: "avatarUrl";

        /** WorkspaceMemberProfileChanged _coverImageUrl. */
        public _coverImageUrl?: "coverImageUrl";

        /** WorkspaceMemberProfileChanged _customImageUrl. */
        public _customImageUrl?: "customImageUrl";

        /** WorkspaceMemberProfileChanged _description. */
        public _description?: "description";

        /**
         * Creates a new WorkspaceMemberProfileChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns WorkspaceMemberProfileChanged instance
         */
        public static create(properties?: notification.IWorkspaceMemberProfileChanged): notification.WorkspaceMemberProfileChanged;

        /**
         * Encodes the specified WorkspaceMemberProfileChanged message. Does not implicitly {@link notification.WorkspaceMemberProfileChanged.verify|verify} messages.
         * @param message WorkspaceMemberProfileChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IWorkspaceMemberProfileChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified WorkspaceMemberProfileChanged message, length delimited. Does not implicitly {@link notification.WorkspaceMemberProfileChanged.verify|verify} messages.
         * @param message WorkspaceMemberProfileChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IWorkspaceMemberProfileChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a WorkspaceMemberProfileChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns WorkspaceMemberProfileChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.WorkspaceMemberProfileChanged;

        /**
         * Decodes a WorkspaceMemberProfileChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns WorkspaceMemberProfileChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.WorkspaceMemberProfileChanged;

        /**
         * Verifies a WorkspaceMemberProfileChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a WorkspaceMemberProfileChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns WorkspaceMemberProfileChanged
         */
        public static fromObject(object: { [k: string]: any }): notification.WorkspaceMemberProfileChanged;

        /**
         * Creates a plain object from a WorkspaceMemberProfileChanged message. Also converts values to other types if specified.
         * @param message WorkspaceMemberProfileChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.WorkspaceMemberProfileChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this WorkspaceMemberProfileChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for WorkspaceMemberProfileChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a FolderChanged. */
    interface IFolderChanged {

        /** FolderChanged outlineDiffJson */
        outlineDiffJson?: (string|null);

        /** FolderChanged folderRid */
        folderRid?: (string|null);
    }

    /** Represents a FolderChanged. */
    class FolderChanged implements IFolderChanged {

        /**
         * Constructs a new FolderChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IFolderChanged);

        /** FolderChanged outlineDiffJson. */
        public outlineDiffJson: string;

        /** FolderChanged folderRid. */
        public folderRid?: (string|null);

        /** FolderChanged _folderRid. */
        public _folderRid?: "folderRid";

        /**
         * Creates a new FolderChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns FolderChanged instance
         */
        public static create(properties?: notification.IFolderChanged): notification.FolderChanged;

        /**
         * Encodes the specified FolderChanged message. Does not implicitly {@link notification.FolderChanged.verify|verify} messages.
         * @param message FolderChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IFolderChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified FolderChanged message, length delimited. Does not implicitly {@link notification.FolderChanged.verify|verify} messages.
         * @param message FolderChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IFolderChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FolderChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns FolderChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.FolderChanged;

        /**
         * Decodes a FolderChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns FolderChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.FolderChanged;

        /**
         * Verifies a FolderChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a FolderChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns FolderChanged
         */
        public static fromObject(object: { [k: string]: any }): notification.FolderChanged;

        /**
         * Creates a plain object from a FolderChanged message. Also converts values to other types if specified.
         * @param message FolderChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.FolderChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this FolderChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for FolderChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a FolderViewChanged. */
    interface IFolderViewChanged {

        /** FolderViewChanged changeType */
        changeType?: (number|null);

        /** FolderViewChanged viewId */
        viewId?: (string|null);

        /** FolderViewChanged viewJson */
        viewJson?: (string|null);

        /** FolderViewChanged parentViewId */
        parentViewId?: (string|null);

        /** FolderViewChanged childViewIds */
        childViewIds?: (string[]|null);

        /** FolderViewChanged folderRid */
        folderRid?: (string|null);
    }

    /** Represents a FolderViewChanged. */
    class FolderViewChanged implements IFolderViewChanged {

        /**
         * Constructs a new FolderViewChanged.
         * @param [properties] Properties to set
         */
        constructor(properties?: notification.IFolderViewChanged);

        /** FolderViewChanged changeType. */
        public changeType: number;

        /** FolderViewChanged viewId. */
        public viewId: string;

        /** FolderViewChanged viewJson. */
        public viewJson?: (string|null);

        /** FolderViewChanged parentViewId. */
        public parentViewId?: (string|null);

        /** FolderViewChanged childViewIds. */
        public childViewIds: string[];

        /** FolderViewChanged folderRid. */
        public folderRid?: (string|null);

        /** FolderViewChanged _viewJson. */
        public _viewJson?: "viewJson";

        /** FolderViewChanged _parentViewId. */
        public _parentViewId?: "parentViewId";

        /** FolderViewChanged _folderRid. */
        public _folderRid?: "folderRid";

        /**
         * Creates a new FolderViewChanged instance using the specified properties.
         * @param [properties] Properties to set
         * @returns FolderViewChanged instance
         */
        public static create(properties?: notification.IFolderViewChanged): notification.FolderViewChanged;

        /**
         * Encodes the specified FolderViewChanged message. Does not implicitly {@link notification.FolderViewChanged.verify|verify} messages.
         * @param message FolderViewChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: notification.IFolderViewChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified FolderViewChanged message, length delimited. Does not implicitly {@link notification.FolderViewChanged.verify|verify} messages.
         * @param message FolderViewChanged message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: notification.IFolderViewChanged, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a FolderViewChanged message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns FolderViewChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): notification.FolderViewChanged;

        /**
         * Decodes a FolderViewChanged message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns FolderViewChanged
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): notification.FolderViewChanged;

        /**
         * Verifies a FolderViewChanged message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a FolderViewChanged message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns FolderViewChanged
         */
        public static fromObject(object: { [k: string]: any }): notification.FolderViewChanged;

        /**
         * Creates a plain object from a FolderViewChanged message. Also converts values to other types if specified.
         * @param message FolderViewChanged
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: notification.FolderViewChanged, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this FolderViewChanged to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for FolderViewChanged
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }
}
