import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace database_blob. */
export namespace database_blob {

    /** Properties of a DatabaseBlobRowRid. */
    interface IDatabaseBlobRowRid {

        /** DatabaseBlobRowRid timestamp */
        timestamp?: (number|Long|null);

        /** DatabaseBlobRowRid seqNo */
        seqNo?: (number|null);
    }

    /** Represents a DatabaseBlobRowRid. */
    class DatabaseBlobRowRid implements IDatabaseBlobRowRid {

        /**
         * Constructs a new DatabaseBlobRowRid.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IDatabaseBlobRowRid);

        /** DatabaseBlobRowRid timestamp. */
        public timestamp: (number|Long);

        /** DatabaseBlobRowRid seqNo. */
        public seqNo: number;

        /**
         * Creates a new DatabaseBlobRowRid instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DatabaseBlobRowRid instance
         */
        public static create(properties?: database_blob.IDatabaseBlobRowRid): database_blob.DatabaseBlobRowRid;

        /**
         * Encodes the specified DatabaseBlobRowRid message. Does not implicitly {@link database_blob.DatabaseBlobRowRid.verify|verify} messages.
         * @param message DatabaseBlobRowRid message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IDatabaseBlobRowRid, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DatabaseBlobRowRid message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowRid.verify|verify} messages.
         * @param message DatabaseBlobRowRid message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IDatabaseBlobRowRid, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DatabaseBlobRowRid message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DatabaseBlobRowRid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.DatabaseBlobRowRid;

        /**
         * Decodes a DatabaseBlobRowRid message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DatabaseBlobRowRid
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.DatabaseBlobRowRid;

        /**
         * Verifies a DatabaseBlobRowRid message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DatabaseBlobRowRid message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DatabaseBlobRowRid
         */
        public static fromObject(object: { [k: string]: any }): database_blob.DatabaseBlobRowRid;

        /**
         * Creates a plain object from a DatabaseBlobRowRid message. Also converts values to other types if specified.
         * @param message DatabaseBlobRowRid
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.DatabaseBlobRowRid, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DatabaseBlobRowRid to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DatabaseBlobRowRid
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a DatabaseBlobDiffRequest. */
    interface IDatabaseBlobDiffRequest {

        /** DatabaseBlobDiffRequest maxKnownRid */
        maxKnownRid?: (database_blob.IDatabaseBlobRowRid|null);

        /** DatabaseBlobDiffRequest version */
        version?: (number|null);
    }

    /** Represents a DatabaseBlobDiffRequest. */
    class DatabaseBlobDiffRequest implements IDatabaseBlobDiffRequest {

        /**
         * Constructs a new DatabaseBlobDiffRequest.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IDatabaseBlobDiffRequest);

        /** DatabaseBlobDiffRequest maxKnownRid. */
        public maxKnownRid?: (database_blob.IDatabaseBlobRowRid|null);

        /** DatabaseBlobDiffRequest version. */
        public version: number;

        /** DatabaseBlobDiffRequest _maxKnownRid. */
        public _maxKnownRid?: "maxKnownRid";

        /**
         * Creates a new DatabaseBlobDiffRequest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DatabaseBlobDiffRequest instance
         */
        public static create(properties?: database_blob.IDatabaseBlobDiffRequest): database_blob.DatabaseBlobDiffRequest;

        /**
         * Encodes the specified DatabaseBlobDiffRequest message. Does not implicitly {@link database_blob.DatabaseBlobDiffRequest.verify|verify} messages.
         * @param message DatabaseBlobDiffRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IDatabaseBlobDiffRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DatabaseBlobDiffRequest message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobDiffRequest.verify|verify} messages.
         * @param message DatabaseBlobDiffRequest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IDatabaseBlobDiffRequest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DatabaseBlobDiffRequest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DatabaseBlobDiffRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.DatabaseBlobDiffRequest;

        /**
         * Decodes a DatabaseBlobDiffRequest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DatabaseBlobDiffRequest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.DatabaseBlobDiffRequest;

        /**
         * Verifies a DatabaseBlobDiffRequest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DatabaseBlobDiffRequest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DatabaseBlobDiffRequest
         */
        public static fromObject(object: { [k: string]: any }): database_blob.DatabaseBlobDiffRequest;

        /**
         * Creates a plain object from a DatabaseBlobDiffRequest message. Also converts values to other types if specified.
         * @param message DatabaseBlobDiffRequest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.DatabaseBlobDiffRequest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DatabaseBlobDiffRequest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DatabaseBlobDiffRequest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a CollabDocState. */
    interface ICollabDocState {

        /** CollabDocState docState */
        docState?: (Uint8Array|null);

        /** CollabDocState encoderVersion */
        encoderVersion?: (number|null);
    }

    /** Represents a CollabDocState. */
    class CollabDocState implements ICollabDocState {

        /**
         * Constructs a new CollabDocState.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.ICollabDocState);

        /** CollabDocState docState. */
        public docState: Uint8Array;

        /** CollabDocState encoderVersion. */
        public encoderVersion: number;

        /**
         * Creates a new CollabDocState instance using the specified properties.
         * @param [properties] Properties to set
         * @returns CollabDocState instance
         */
        public static create(properties?: database_blob.ICollabDocState): database_blob.CollabDocState;

        /**
         * Encodes the specified CollabDocState message. Does not implicitly {@link database_blob.CollabDocState.verify|verify} messages.
         * @param message CollabDocState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.ICollabDocState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified CollabDocState message, length delimited. Does not implicitly {@link database_blob.CollabDocState.verify|verify} messages.
         * @param message CollabDocState message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.ICollabDocState, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a CollabDocState message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns CollabDocState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.CollabDocState;

        /**
         * Decodes a CollabDocState message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns CollabDocState
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.CollabDocState;

        /**
         * Verifies a CollabDocState message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a CollabDocState message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns CollabDocState
         */
        public static fromObject(object: { [k: string]: any }): database_blob.CollabDocState;

        /**
         * Creates a plain object from a CollabDocState message. Also converts values to other types if specified.
         * @param message CollabDocState
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.CollabDocState, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this CollabDocState to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for CollabDocState
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a DatabaseBlobRowDocument. */
    interface IDatabaseBlobRowDocument {

        /** DatabaseBlobRowDocument documentId */
        documentId?: (Uint8Array|null);

        /** DatabaseBlobRowDocument rid */
        rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** DatabaseBlobRowDocument deleted */
        deleted?: (boolean|null);

        /** DatabaseBlobRowDocument docState */
        docState?: (database_blob.ICollabDocState|null);
    }

    /** Represents a DatabaseBlobRowDocument. */
    class DatabaseBlobRowDocument implements IDatabaseBlobRowDocument {

        /**
         * Constructs a new DatabaseBlobRowDocument.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IDatabaseBlobRowDocument);

        /** DatabaseBlobRowDocument documentId. */
        public documentId: Uint8Array;

        /** DatabaseBlobRowDocument rid. */
        public rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** DatabaseBlobRowDocument deleted. */
        public deleted: boolean;

        /** DatabaseBlobRowDocument docState. */
        public docState?: (database_blob.ICollabDocState|null);

        /**
         * Creates a new DatabaseBlobRowDocument instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DatabaseBlobRowDocument instance
         */
        public static create(properties?: database_blob.IDatabaseBlobRowDocument): database_blob.DatabaseBlobRowDocument;

        /**
         * Encodes the specified DatabaseBlobRowDocument message. Does not implicitly {@link database_blob.DatabaseBlobRowDocument.verify|verify} messages.
         * @param message DatabaseBlobRowDocument message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IDatabaseBlobRowDocument, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DatabaseBlobRowDocument message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowDocument.verify|verify} messages.
         * @param message DatabaseBlobRowDocument message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IDatabaseBlobRowDocument, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DatabaseBlobRowDocument message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DatabaseBlobRowDocument
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.DatabaseBlobRowDocument;

        /**
         * Decodes a DatabaseBlobRowDocument message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DatabaseBlobRowDocument
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.DatabaseBlobRowDocument;

        /**
         * Verifies a DatabaseBlobRowDocument message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DatabaseBlobRowDocument message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DatabaseBlobRowDocument
         */
        public static fromObject(object: { [k: string]: any }): database_blob.DatabaseBlobRowDocument;

        /**
         * Creates a plain object from a DatabaseBlobRowDocument message. Also converts values to other types if specified.
         * @param message DatabaseBlobRowDocument
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.DatabaseBlobRowDocument, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DatabaseBlobRowDocument to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DatabaseBlobRowDocument
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a DatabaseBlobRowUpdate. */
    interface IDatabaseBlobRowUpdate {

        /** DatabaseBlobRowUpdate rowId */
        rowId?: (Uint8Array|null);

        /** DatabaseBlobRowUpdate rid */
        rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** DatabaseBlobRowUpdate docState */
        docState?: (database_blob.ICollabDocState|null);

        /** DatabaseBlobRowUpdate document */
        document?: (database_blob.IDatabaseBlobRowDocument|null);
    }

    /** Represents a DatabaseBlobRowUpdate. */
    class DatabaseBlobRowUpdate implements IDatabaseBlobRowUpdate {

        /**
         * Constructs a new DatabaseBlobRowUpdate.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IDatabaseBlobRowUpdate);

        /** DatabaseBlobRowUpdate rowId. */
        public rowId: Uint8Array;

        /** DatabaseBlobRowUpdate rid. */
        public rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** DatabaseBlobRowUpdate docState. */
        public docState?: (database_blob.ICollabDocState|null);

        /** DatabaseBlobRowUpdate document. */
        public document?: (database_blob.IDatabaseBlobRowDocument|null);

        /** DatabaseBlobRowUpdate _document. */
        public _document?: "document";

        /**
         * Creates a new DatabaseBlobRowUpdate instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DatabaseBlobRowUpdate instance
         */
        public static create(properties?: database_blob.IDatabaseBlobRowUpdate): database_blob.DatabaseBlobRowUpdate;

        /**
         * Encodes the specified DatabaseBlobRowUpdate message. Does not implicitly {@link database_blob.DatabaseBlobRowUpdate.verify|verify} messages.
         * @param message DatabaseBlobRowUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IDatabaseBlobRowUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DatabaseBlobRowUpdate message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowUpdate.verify|verify} messages.
         * @param message DatabaseBlobRowUpdate message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IDatabaseBlobRowUpdate, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DatabaseBlobRowUpdate message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DatabaseBlobRowUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.DatabaseBlobRowUpdate;

        /**
         * Decodes a DatabaseBlobRowUpdate message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DatabaseBlobRowUpdate
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.DatabaseBlobRowUpdate;

        /**
         * Verifies a DatabaseBlobRowUpdate message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DatabaseBlobRowUpdate message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DatabaseBlobRowUpdate
         */
        public static fromObject(object: { [k: string]: any }): database_blob.DatabaseBlobRowUpdate;

        /**
         * Creates a plain object from a DatabaseBlobRowUpdate message. Also converts values to other types if specified.
         * @param message DatabaseBlobRowUpdate
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.DatabaseBlobRowUpdate, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DatabaseBlobRowUpdate to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DatabaseBlobRowUpdate
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a DatabaseBlobRowDelete. */
    interface IDatabaseBlobRowDelete {

        /** DatabaseBlobRowDelete rowId */
        rowId?: (Uint8Array|null);

        /** DatabaseBlobRowDelete rid */
        rid?: (database_blob.IDatabaseBlobRowRid|null);
    }

    /** Represents a DatabaseBlobRowDelete. */
    class DatabaseBlobRowDelete implements IDatabaseBlobRowDelete {

        /**
         * Constructs a new DatabaseBlobRowDelete.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IDatabaseBlobRowDelete);

        /** DatabaseBlobRowDelete rowId. */
        public rowId: Uint8Array;

        /** DatabaseBlobRowDelete rid. */
        public rid?: (database_blob.IDatabaseBlobRowRid|null);

        /**
         * Creates a new DatabaseBlobRowDelete instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DatabaseBlobRowDelete instance
         */
        public static create(properties?: database_blob.IDatabaseBlobRowDelete): database_blob.DatabaseBlobRowDelete;

        /**
         * Encodes the specified DatabaseBlobRowDelete message. Does not implicitly {@link database_blob.DatabaseBlobRowDelete.verify|verify} messages.
         * @param message DatabaseBlobRowDelete message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IDatabaseBlobRowDelete, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DatabaseBlobRowDelete message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobRowDelete.verify|verify} messages.
         * @param message DatabaseBlobRowDelete message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IDatabaseBlobRowDelete, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DatabaseBlobRowDelete message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DatabaseBlobRowDelete
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.DatabaseBlobRowDelete;

        /**
         * Decodes a DatabaseBlobRowDelete message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DatabaseBlobRowDelete
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.DatabaseBlobRowDelete;

        /**
         * Verifies a DatabaseBlobRowDelete message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DatabaseBlobRowDelete message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DatabaseBlobRowDelete
         */
        public static fromObject(object: { [k: string]: any }): database_blob.DatabaseBlobRowDelete;

        /**
         * Creates a plain object from a DatabaseBlobRowDelete message. Also converts values to other types if specified.
         * @param message DatabaseBlobRowDelete
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.DatabaseBlobRowDelete, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DatabaseBlobRowDelete to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DatabaseBlobRowDelete
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a DatabaseBlobDiffResponse. */
    interface IDatabaseBlobDiffResponse {

        /** DatabaseBlobDiffResponse manifestVersion */
        manifestVersion?: (string|null);

        /** DatabaseBlobDiffResponse headBlobKey */
        headBlobKey?: (string|null);

        /** DatabaseBlobDiffResponse updates */
        updates?: (database_blob.IDatabaseBlobRowUpdate[]|null);

        /** DatabaseBlobDiffResponse deletes */
        deletes?: (database_blob.IDatabaseBlobRowDelete[]|null);

        /** DatabaseBlobDiffResponse creates */
        creates?: (database_blob.IDatabaseBlobRowUpdate[]|null);

        /** DatabaseBlobDiffResponse status */
        status?: (database_blob.DiffStatus|null);

        /** DatabaseBlobDiffResponse retryAfterSecs */
        retryAfterSecs?: (number|null);

        /** DatabaseBlobDiffResponse message */
        message?: (string|null);
    }

    /** Represents a DatabaseBlobDiffResponse. */
    class DatabaseBlobDiffResponse implements IDatabaseBlobDiffResponse {

        /**
         * Constructs a new DatabaseBlobDiffResponse.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IDatabaseBlobDiffResponse);

        /** DatabaseBlobDiffResponse manifestVersion. */
        public manifestVersion: string;

        /** DatabaseBlobDiffResponse headBlobKey. */
        public headBlobKey?: (string|null);

        /** DatabaseBlobDiffResponse updates. */
        public updates: database_blob.IDatabaseBlobRowUpdate[];

        /** DatabaseBlobDiffResponse deletes. */
        public deletes: database_blob.IDatabaseBlobRowDelete[];

        /** DatabaseBlobDiffResponse creates. */
        public creates: database_blob.IDatabaseBlobRowUpdate[];

        /** DatabaseBlobDiffResponse status. */
        public status: database_blob.DiffStatus;

        /** DatabaseBlobDiffResponse retryAfterSecs. */
        public retryAfterSecs?: (number|null);

        /** DatabaseBlobDiffResponse message. */
        public message?: (string|null);

        /** DatabaseBlobDiffResponse _headBlobKey. */
        public _headBlobKey?: "headBlobKey";

        /** DatabaseBlobDiffResponse _retryAfterSecs. */
        public _retryAfterSecs?: "retryAfterSecs";

        /** DatabaseBlobDiffResponse _message. */
        public _message?: "message";

        /**
         * Creates a new DatabaseBlobDiffResponse instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DatabaseBlobDiffResponse instance
         */
        public static create(properties?: database_blob.IDatabaseBlobDiffResponse): database_blob.DatabaseBlobDiffResponse;

        /**
         * Encodes the specified DatabaseBlobDiffResponse message. Does not implicitly {@link database_blob.DatabaseBlobDiffResponse.verify|verify} messages.
         * @param message DatabaseBlobDiffResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IDatabaseBlobDiffResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DatabaseBlobDiffResponse message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobDiffResponse.verify|verify} messages.
         * @param message DatabaseBlobDiffResponse message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IDatabaseBlobDiffResponse, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DatabaseBlobDiffResponse message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DatabaseBlobDiffResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.DatabaseBlobDiffResponse;

        /**
         * Decodes a DatabaseBlobDiffResponse message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DatabaseBlobDiffResponse
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.DatabaseBlobDiffResponse;

        /**
         * Verifies a DatabaseBlobDiffResponse message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DatabaseBlobDiffResponse message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DatabaseBlobDiffResponse
         */
        public static fromObject(object: { [k: string]: any }): database_blob.DatabaseBlobDiffResponse;

        /**
         * Creates a plain object from a DatabaseBlobDiffResponse message. Also converts values to other types if specified.
         * @param message DatabaseBlobDiffResponse
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.DatabaseBlobDiffResponse, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DatabaseBlobDiffResponse to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DatabaseBlobDiffResponse
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a BlobDescriptor. */
    interface IBlobDescriptor {

        /** BlobDescriptor key */
        key?: (string|null);

        /** BlobDescriptor startRid */
        startRid?: (database_blob.IDatabaseBlobRowRid|null);

        /** BlobDescriptor endRid */
        endRid?: (database_blob.IDatabaseBlobRowRid|null);

        /** BlobDescriptor totalBytes */
        totalBytes?: (number|Long|null);

        /** BlobDescriptor sealed */
        sealed?: (boolean|null);
    }

    /** Represents a BlobDescriptor. */
    class BlobDescriptor implements IBlobDescriptor {

        /**
         * Constructs a new BlobDescriptor.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IBlobDescriptor);

        /** BlobDescriptor key. */
        public key: string;

        /** BlobDescriptor startRid. */
        public startRid?: (database_blob.IDatabaseBlobRowRid|null);

        /** BlobDescriptor endRid. */
        public endRid?: (database_blob.IDatabaseBlobRowRid|null);

        /** BlobDescriptor totalBytes. */
        public totalBytes: (number|Long);

        /** BlobDescriptor sealed. */
        public sealed: boolean;

        /** BlobDescriptor _startRid. */
        public _startRid?: "startRid";

        /** BlobDescriptor _endRid. */
        public _endRid?: "endRid";

        /**
         * Creates a new BlobDescriptor instance using the specified properties.
         * @param [properties] Properties to set
         * @returns BlobDescriptor instance
         */
        public static create(properties?: database_blob.IBlobDescriptor): database_blob.BlobDescriptor;

        /**
         * Encodes the specified BlobDescriptor message. Does not implicitly {@link database_blob.BlobDescriptor.verify|verify} messages.
         * @param message BlobDescriptor message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IBlobDescriptor, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified BlobDescriptor message, length delimited. Does not implicitly {@link database_blob.BlobDescriptor.verify|verify} messages.
         * @param message BlobDescriptor message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IBlobDescriptor, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a BlobDescriptor message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns BlobDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.BlobDescriptor;

        /**
         * Decodes a BlobDescriptor message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns BlobDescriptor
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.BlobDescriptor;

        /**
         * Verifies a BlobDescriptor message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a BlobDescriptor message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns BlobDescriptor
         */
        public static fromObject(object: { [k: string]: any }): database_blob.BlobDescriptor;

        /**
         * Creates a plain object from a BlobDescriptor message. Also converts values to other types if specified.
         * @param message BlobDescriptor
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.BlobDescriptor, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this BlobDescriptor to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for BlobDescriptor
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ManifestRowDocumentPointer. */
    interface IManifestRowDocumentPointer {

        /** ManifestRowDocumentPointer documentId */
        documentId?: (Uint8Array|null);

        /** ManifestRowDocumentPointer rid */
        rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** ManifestRowDocumentPointer deleted */
        deleted?: (boolean|null);
    }

    /** Represents a ManifestRowDocumentPointer. */
    class ManifestRowDocumentPointer implements IManifestRowDocumentPointer {

        /**
         * Constructs a new ManifestRowDocumentPointer.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IManifestRowDocumentPointer);

        /** ManifestRowDocumentPointer documentId. */
        public documentId: Uint8Array;

        /** ManifestRowDocumentPointer rid. */
        public rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** ManifestRowDocumentPointer deleted. */
        public deleted: boolean;

        /**
         * Creates a new ManifestRowDocumentPointer instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ManifestRowDocumentPointer instance
         */
        public static create(properties?: database_blob.IManifestRowDocumentPointer): database_blob.ManifestRowDocumentPointer;

        /**
         * Encodes the specified ManifestRowDocumentPointer message. Does not implicitly {@link database_blob.ManifestRowDocumentPointer.verify|verify} messages.
         * @param message ManifestRowDocumentPointer message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IManifestRowDocumentPointer, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ManifestRowDocumentPointer message, length delimited. Does not implicitly {@link database_blob.ManifestRowDocumentPointer.verify|verify} messages.
         * @param message ManifestRowDocumentPointer message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IManifestRowDocumentPointer, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ManifestRowDocumentPointer message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ManifestRowDocumentPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.ManifestRowDocumentPointer;

        /**
         * Decodes a ManifestRowDocumentPointer message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ManifestRowDocumentPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.ManifestRowDocumentPointer;

        /**
         * Verifies a ManifestRowDocumentPointer message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ManifestRowDocumentPointer message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ManifestRowDocumentPointer
         */
        public static fromObject(object: { [k: string]: any }): database_blob.ManifestRowDocumentPointer;

        /**
         * Creates a plain object from a ManifestRowDocumentPointer message. Also converts values to other types if specified.
         * @param message ManifestRowDocumentPointer
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.ManifestRowDocumentPointer, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ManifestRowDocumentPointer to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ManifestRowDocumentPointer
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a ManifestRowPointer. */
    interface IManifestRowPointer {

        /** ManifestRowPointer rowId */
        rowId?: (Uint8Array|null);

        /** ManifestRowPointer blobIndex */
        blobIndex?: (number|null);

        /** ManifestRowPointer segmentOffset */
        segmentOffset?: (number|Long|null);

        /** ManifestRowPointer rid */
        rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** ManifestRowPointer deleted */
        deleted?: (boolean|null);

        /** ManifestRowPointer document */
        document?: (database_blob.IManifestRowDocumentPointer|null);
    }

    /** Represents a ManifestRowPointer. */
    class ManifestRowPointer implements IManifestRowPointer {

        /**
         * Constructs a new ManifestRowPointer.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IManifestRowPointer);

        /** ManifestRowPointer rowId. */
        public rowId: Uint8Array;

        /** ManifestRowPointer blobIndex. */
        public blobIndex: number;

        /** ManifestRowPointer segmentOffset. */
        public segmentOffset: (number|Long);

        /** ManifestRowPointer rid. */
        public rid?: (database_blob.IDatabaseBlobRowRid|null);

        /** ManifestRowPointer deleted. */
        public deleted: boolean;

        /** ManifestRowPointer document. */
        public document?: (database_blob.IManifestRowDocumentPointer|null);

        /** ManifestRowPointer _document. */
        public _document?: "document";

        /**
         * Creates a new ManifestRowPointer instance using the specified properties.
         * @param [properties] Properties to set
         * @returns ManifestRowPointer instance
         */
        public static create(properties?: database_blob.IManifestRowPointer): database_blob.ManifestRowPointer;

        /**
         * Encodes the specified ManifestRowPointer message. Does not implicitly {@link database_blob.ManifestRowPointer.verify|verify} messages.
         * @param message ManifestRowPointer message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IManifestRowPointer, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified ManifestRowPointer message, length delimited. Does not implicitly {@link database_blob.ManifestRowPointer.verify|verify} messages.
         * @param message ManifestRowPointer message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IManifestRowPointer, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a ManifestRowPointer message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns ManifestRowPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.ManifestRowPointer;

        /**
         * Decodes a ManifestRowPointer message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns ManifestRowPointer
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.ManifestRowPointer;

        /**
         * Verifies a ManifestRowPointer message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a ManifestRowPointer message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns ManifestRowPointer
         */
        public static fromObject(object: { [k: string]: any }): database_blob.ManifestRowPointer;

        /**
         * Creates a plain object from a ManifestRowPointer message. Also converts values to other types if specified.
         * @param message ManifestRowPointer
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.ManifestRowPointer, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this ManifestRowPointer to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for ManifestRowPointer
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** Properties of a DatabaseBlobManifest. */
    interface IDatabaseBlobManifest {

        /** DatabaseBlobManifest workspaceId */
        workspaceId?: (Uint8Array|null);

        /** DatabaseBlobManifest databaseId */
        databaseId?: (Uint8Array|null);

        /** DatabaseBlobManifest versionId */
        versionId?: (string|null);

        /** DatabaseBlobManifest blobs */
        blobs?: (database_blob.IBlobDescriptor[]|null);

        /** DatabaseBlobManifest rowIndex */
        rowIndex?: (database_blob.IManifestRowPointer[]|null);

        /** DatabaseBlobManifest updatedAtMillis */
        updatedAtMillis?: (number|Long|null);

        /** DatabaseBlobManifest lockEpoch */
        lockEpoch?: (number|Long|null);
    }

    /** Represents a DatabaseBlobManifest. */
    class DatabaseBlobManifest implements IDatabaseBlobManifest {

        /**
         * Constructs a new DatabaseBlobManifest.
         * @param [properties] Properties to set
         */
        constructor(properties?: database_blob.IDatabaseBlobManifest);

        /** DatabaseBlobManifest workspaceId. */
        public workspaceId: Uint8Array;

        /** DatabaseBlobManifest databaseId. */
        public databaseId: Uint8Array;

        /** DatabaseBlobManifest versionId. */
        public versionId: string;

        /** DatabaseBlobManifest blobs. */
        public blobs: database_blob.IBlobDescriptor[];

        /** DatabaseBlobManifest rowIndex. */
        public rowIndex: database_blob.IManifestRowPointer[];

        /** DatabaseBlobManifest updatedAtMillis. */
        public updatedAtMillis: (number|Long);

        /** DatabaseBlobManifest lockEpoch. */
        public lockEpoch: (number|Long);

        /**
         * Creates a new DatabaseBlobManifest instance using the specified properties.
         * @param [properties] Properties to set
         * @returns DatabaseBlobManifest instance
         */
        public static create(properties?: database_blob.IDatabaseBlobManifest): database_blob.DatabaseBlobManifest;

        /**
         * Encodes the specified DatabaseBlobManifest message. Does not implicitly {@link database_blob.DatabaseBlobManifest.verify|verify} messages.
         * @param message DatabaseBlobManifest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encode(message: database_blob.IDatabaseBlobManifest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Encodes the specified DatabaseBlobManifest message, length delimited. Does not implicitly {@link database_blob.DatabaseBlobManifest.verify|verify} messages.
         * @param message DatabaseBlobManifest message or plain object to encode
         * @param [writer] Writer to encode to
         * @returns Writer
         */
        public static encodeDelimited(message: database_blob.IDatabaseBlobManifest, writer?: $protobuf.Writer): $protobuf.Writer;

        /**
         * Decodes a DatabaseBlobManifest message from the specified reader or buffer.
         * @param reader Reader or buffer to decode from
         * @param [length] Message length if known beforehand
         * @returns DatabaseBlobManifest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): database_blob.DatabaseBlobManifest;

        /**
         * Decodes a DatabaseBlobManifest message from the specified reader or buffer, length delimited.
         * @param reader Reader or buffer to decode from
         * @returns DatabaseBlobManifest
         * @throws {Error} If the payload is not a reader or valid buffer
         * @throws {$protobuf.util.ProtocolError} If required fields are missing
         */
        public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): database_blob.DatabaseBlobManifest;

        /**
         * Verifies a DatabaseBlobManifest message.
         * @param message Plain object to verify
         * @returns `null` if valid, otherwise the reason why it is not
         */
        public static verify(message: { [k: string]: any }): (string|null);

        /**
         * Creates a DatabaseBlobManifest message from a plain object. Also converts values to their respective internal types.
         * @param object Plain object
         * @returns DatabaseBlobManifest
         */
        public static fromObject(object: { [k: string]: any }): database_blob.DatabaseBlobManifest;

        /**
         * Creates a plain object from a DatabaseBlobManifest message. Also converts values to other types if specified.
         * @param message DatabaseBlobManifest
         * @param [options] Conversion options
         * @returns Plain object
         */
        public static toObject(message: database_blob.DatabaseBlobManifest, options?: $protobuf.IConversionOptions): { [k: string]: any };

        /**
         * Converts this DatabaseBlobManifest to JSON.
         * @returns JSON object
         */
        public toJSON(): { [k: string]: any };

        /**
         * Gets the default type url for DatabaseBlobManifest
         * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
         * @returns The default type url
         */
        public static getTypeUrl(typeUrlPrefix?: string): string;
    }

    /** DiffStatus enum. */
    enum DiffStatus {
        READY = 0,
        PENDING = 1
    }
}
