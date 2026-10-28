type Nullable<T> = T | null | undefined
export declare class JsSeamAnswer {
    private constructor();
    get ok(): boolean;
    get value(): Nullable<string>;
    get capability(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsWireEvent {
    private constructor();
    get kind(): number;
    get pubkey(): string;
    get createdAtSeconds(): string;
    get content(): string;
    get tags(): Array<Array<string>>;
    unsignedJson(): JsText;
    toString(): string;
}
export declare class JsText {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get value(): Nullable<string>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsBuildResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get event(): Nullable<JsWireEvent>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get tagReason(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare function capabilities(): JsCapabilities;
export declare class JsCapabilities {
    private constructor();
    get specification(): string;
    get items(): Array<JsConformanceItem>;
    get notPerformedHere(): Array<string>;
    get report(): string;
    toString(): string;
}
export declare class JsConformanceItem {
    private constructor();
    get number(): number;
    get status(): string;
    get specSections(): Array<string>;
    get evidenceClasses(): Array<string>;
    get notPerformed(): Array<string>;
    get note(): string;
    toString(): string;
}
export declare class JsRumorEnvelope {
    constructor(authorPubkey: string, createdAtSeconds: string, counterparties?: Array<Array<string>>, content?: string, nenyaVersion?: number, extraTags?: Array<Array<string>>);
    get authorPubkey(): string;
    get createdAtSeconds(): string;
    get counterparties(): Array<Array<string>>;
    get content(): string;
    get nenyaVersion(): number;
    get extraTags(): Array<Array<string>>;
    toString(): string;
}
export declare class JsOrderTerms {
    constructor(priceMsat: string, feeBasisPoints?: Nullable<number>, expirationSeconds?: Nullable<string>, deliverBySeconds?: Nullable<string>);
    get priceMsat(): string;
    get feeBasisPoints(): Nullable<number>;
    get expirationSeconds(): Nullable<string>;
    get deliverBySeconds(): Nullable<string>;
    toString(): string;
}
export declare class JsCommitment {
    constructor(xHex: string, oxHex: string, mimeType: string, sizeBytes: string);
    get xHex(): string;
    get oxHex(): string;
    get mimeType(): string;
    get sizeBytes(): string;
    toString(): string;
}
export declare class JsRelease {
    constructor(xHex: string, oxHex: string, fileType: Nullable<string>, sizeBytes: string);
    get xHex(): string;
    get oxHex(): string;
    get fileType(): Nullable<string>;
    get sizeBytes(): string;
    toString(): string;
}
export declare function buildChat(envelope: JsRumorEnvelope, orderIdHex?: Nullable<string>): JsBuildResult;
export declare function buildProposal(envelope: JsRumorEnvelope, orderIdHex: string, itemCoordinate: string, terms: JsOrderTerms, feeRecipient?: Nullable<string>, amountSat?: Nullable<string>): JsBuildResult;
export declare function buildStatusUpdate(envelope: JsRumorEnvelope, orderIdHex: string, statusToken: string, itemCoordinate?: Nullable<string>, terms?: Nullable<JsOrderTerms>, feeRecipient?: Nullable<string>): JsBuildResult;
export declare function buildCommitment(envelope: JsRumorEnvelope, orderIdHex: string, commitment: JsCommitment, url: string): JsBuildResult;
export declare function buildRelease(envelope: JsRumorEnvelope, orderIdHex: string, release: JsRelease, decryptionKeyHex: string, decryptionNonceHex: string): JsBuildResult;
export declare function buildPrivateBid(envelope: JsRumorEnvelope, itemCoordinate: string, terms: JsOrderTerms, feeRecipient?: Nullable<string>): JsBuildResult;
export declare function buildPaymentRequest(envelope: JsRumorEnvelope, orderIdHex: string, payeeToken: string, invoice: string, feeRecipient?: Nullable<string>, mediumToken?: string, terms?: Nullable<JsOrderTerms>): JsBuildResult;
export declare function buildReceipt(envelope: JsRumorEnvelope, orderIdHex: string, payeeToken: string, reference: string, proof: string, feeRecipient?: Nullable<string>, mediumToken?: string, terms?: Nullable<JsOrderTerms>): JsBuildResult;
export declare function seal(rumor: JsWireEvent, recipientPubkey: string, sender: JsSigner, environment?: JsEnvironment, recipientRelayHint?: Nullable<string>): JsSealResult;
export declare function open(wrapJson: string, me: JsSigner, environment?: JsEnvironment): JsOpenResult;
export declare class JsOutgoingWrap {
    private constructor();
    get json(): string;
    get idHex(): string;
    get addressee(): string;
    toString(): string;
}
export declare class JsSealResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get toRecipient(): Nullable<JsOutgoingWrap>;
    get toSelf(): Nullable<JsOutgoingWrap>;
    get notPerformedHere(): Array<string>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsRumor {
    private constructor();
    get author(): string;
    get idHex(): string;
    get createdAtSeconds(): string;
    get content(): string;
    get kind(): string;
    get kindNumber(): number;
    get attribution(): string;
    get notPerformedHere(): Array<string>;
    get nenyaVersion(): Nullable<number>;
    get counterparties(): Array<Array<string>>;
    get unknownTags(): Array<Array<string>>;
    get messageType(): Nullable<string>;
    get orderIdHex(): Nullable<string>;
    get event(): JsWireEvent;
    toString(): string;
}
export declare class JsOpenResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get rumor(): Nullable<JsRumor>;
    get sealSignature(): Nullable<string>;
    get wrapSignature(): Nullable<string>;
    get wrapIdHex(): Nullable<string>;
    get notPerformedHere(): Array<string>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare function decodeListing(eventJson: string): JsListingResult;
export declare function decodeBid(eventJson: string): JsBidResult;
export declare function buildListingRequest(listing: JsAuthoredListing): JsBuildResult;
export declare function buildListingOffer(listing: JsAuthoredListing): JsBuildResult;
export declare function buildListingDraft(listing: JsAuthoredListing): JsBuildResult;
export declare function buildBid(bid: JsAuthoredBid): JsBuildResult;
export declare function listingActivity(listing: JsListing, environment: JsEnvironment): string;
export declare function bidActivity(bid: JsBid, environment: JsEnvironment): string;
export declare function checkDeadlines(listing: JsListing, bid: Nullable<JsBid>, environment: JsEnvironment): JsDeadlineCheck;
export declare class JsListing {
    private constructor();
    get idHex(): string;
    get authorPubkey(): string;
    get createdAtSeconds(): string;
    get content(): string;
    get kind(): number;
    get dValue(): string;
    get coordinate(): string;
    get title(): string;
    get priceMsat(): string;
    get status(): string;
    get side(): string;
    get statusToken(): Nullable<string>;
    get summary(): Nullable<string>;
    get publishedAtSeconds(): Nullable<string>;
    get topics(): Array<string>;
    get mimeType(): Nullable<string>;
    get images(): Array<Array<string>>;
    get expirationSeconds(): Nullable<string>;
    get alt(): Nullable<string>;
    get nenyaVersion(): Nullable<number>;
    get pubkeyRefs(): Array<Array<string>>;
    get feeBasisPoints(): Nullable<number>;
    get feeRecipient(): Nullable<string>;
    get license(): Nullable<string>;
    get deliverBySeconds(): Nullable<string>;
    get unknownTags(): Array<Array<string>>;
    toString(): string;
}
export declare class JsBid {
    private constructor();
    get idHex(): string;
    get bidderPubkey(): string;
    get createdAtSeconds(): string;
    get content(): string;
    get kind(): number;
    get listingCoordinate(): string;
    get listingKind(): number;
    get listingAuthorPubkey(): string;
    get priceMsat(): string;
    get rootRelayHint(): Nullable<string>;
    get parentRelayHint(): Nullable<string>;
    get expirationSeconds(): Nullable<string>;
    get openEnded(): boolean;
    get deliverBySeconds(): Nullable<string>;
    get feeBasisPoints(): Nullable<number>;
    get feeRecipient(): Nullable<string>;
    get alt(): Nullable<string>;
    get nenyaVersion(): Nullable<number>;
    get topics(): Array<string>;
    get unknownTags(): Array<Array<string>>;
    toString(): string;
}
export declare class JsDeadlineCheck {
    private constructor();
    get kind(): string;
    get permitted(): boolean;
    get side(): Nullable<string>;
    get reason(): Nullable<string>;
    toString(): string;
}
export declare class JsListingResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get listing(): Nullable<JsListing>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get tagReason(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsBidResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get bid(): Nullable<JsBid>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get tagReason(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsAuthoredListing {
    constructor(authorPubkey: string, createdAtSeconds: string, dValue: string, title: string, priceMsat: string, content?: string, summary?: Nullable<string>, publishedAtSeconds?: Nullable<string>, statusToken?: Nullable<string>, mimeType?: Nullable<string>, topics?: Array<string>, images?: Array<Array<string>>, expirationSeconds?: Nullable<string>, alt?: Nullable<string>, nenyaVersion?: number, pubkeyRefs?: Array<Array<string>>, feeBasisPoints?: Nullable<number>, feeRecipient?: Nullable<string>, license?: Nullable<string>, deliverBySeconds?: Nullable<string>, extraTags?: Array<Array<string>>);
    get authorPubkey(): string;
    get createdAtSeconds(): string;
    get dValue(): string;
    get title(): string;
    get priceMsat(): string;
    get content(): string;
    get summary(): Nullable<string>;
    get publishedAtSeconds(): Nullable<string>;
    get statusToken(): Nullable<string>;
    get mimeType(): Nullable<string>;
    get topics(): Array<string>;
    get images(): Array<Array<string>>;
    get expirationSeconds(): Nullable<string>;
    get alt(): Nullable<string>;
    get nenyaVersion(): number;
    get pubkeyRefs(): Array<Array<string>>;
    get feeBasisPoints(): Nullable<number>;
    get feeRecipient(): Nullable<string>;
    get license(): Nullable<string>;
    get deliverBySeconds(): Nullable<string>;
    get extraTags(): Array<Array<string>>;
    toString(): string;
}
export declare class JsAuthoredBid {
    constructor(bidderPubkey: string, createdAtSeconds: string, listingCoordinate: string, priceMsat: string, content?: string, rootRelayHint?: Nullable<string>, parentRelayHint?: Nullable<string>, feeBasisPoints?: Nullable<number>, feeRecipient?: Nullable<string>, deliverBySeconds?: Nullable<string>, expirationSeconds?: Nullable<string>, topics?: Array<string>, nenyaVersion?: number, alt?: Nullable<string>, dValue?: Nullable<string>, title?: Nullable<string>, summary?: Nullable<string>, publishedAtSeconds?: Nullable<string>, status?: Nullable<string>, mimeType?: Nullable<string>, images?: Array<Array<string>>, license?: Nullable<string>, extraTags?: Array<Array<string>>);
    get bidderPubkey(): string;
    get createdAtSeconds(): string;
    get listingCoordinate(): string;
    get priceMsat(): string;
    get content(): string;
    get rootRelayHint(): Nullable<string>;
    get parentRelayHint(): Nullable<string>;
    get feeBasisPoints(): Nullable<number>;
    get feeRecipient(): Nullable<string>;
    get deliverBySeconds(): Nullable<string>;
    get expirationSeconds(): Nullable<string>;
    get topics(): Array<string>;
    get nenyaVersion(): number;
    get alt(): Nullable<string>;
    get dValue(): Nullable<string>;
    get title(): Nullable<string>;
    get summary(): Nullable<string>;
    get publishedAtSeconds(): Nullable<string>;
    get status(): Nullable<string>;
    get mimeType(): Nullable<string>;
    get images(): Array<Array<string>>;
    get license(): Nullable<string>;
    get extraTags(): Array<Array<string>>;
    toString(): string;
}
export declare function decodeProposal(rumor: JsRumor): JsProposalResult;
export declare function decodeCommitment(rumor: JsRumor): JsCommitmentResult;
export declare function decodeRelease(rumor: JsRumor): JsReleaseResult;
export declare function decodeStatusUpdate(rumor: JsRumor): JsStatusUpdateResult;
export declare class JsOrderProposal {
    private constructor();
    get buyer(): string;
    get idHex(): string;
    get createdAtSeconds(): string;
    get orderIdHex(): string;
    get itemCoordinate(): string;
    get itemQuantity(): string;
    get priceMsat(): string;
    get feeMsat(): string;
    get totalMsat(): string;
    get feeBasisPoints(): Nullable<number>;
    get feePayeeRequired(): boolean;
    get feeRecipient(): Nullable<string>;
    get expirationSeconds(): Nullable<string>;
    get deliverBySeconds(): Nullable<string>;
    get counterparties(): Array<Array<string>>;
    get event(): JsWireEvent;
    toString(): string;
}
export declare class JsProposalResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get proposal(): Nullable<JsOrderProposal>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsCommitmentMessage {
    private constructor();
    get sender(): string;
    get idHex(): string;
    get createdAtSeconds(): string;
    get orderIdHex(): string;
    get url(): string;
    get commitment(): JsCommitment;
    get event(): JsWireEvent;
    toString(): string;
}
export declare class JsCommitmentResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get commitment(): Nullable<JsCommitmentMessage>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsReleaseMessage {
    private constructor();
    get sender(): string;
    get idHex(): string;
    get createdAtSeconds(): string;
    get orderIdHex(): string;
    get release(): JsRelease;
    get event(): JsWireEvent;
    toString(): string;
}
export declare class JsReleaseResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get release(): Nullable<JsReleaseMessage>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsStatusUpdate {
    private constructor();
    get sender(): string;
    get idHex(): string;
    get createdAtSeconds(): string;
    get orderIdHex(): string;
    get status(): string;
    get statusToken(): Nullable<string>;
    get event(): JsWireEvent;
    toString(): string;
}
export declare class JsStatusUpdateResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get statusUpdate(): Nullable<JsStatusUpdate>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare function openOrder(machine: JsOrderMachine, orderIdHex: string, terms: JsOrderTerms, createdAtSeconds?: Nullable<string>): JsOrderResult;
export declare function stepOrder(machine: JsOrderMachine, order: JsOrder, event: JsOrderEvent): JsOrderOutcome;
export declare function verifyServedBytes(commitment: JsCommitment, servedBytesHex: string, maxServedBytes?: Nullable<string>): JsServedBytesResult;
export declare function checkAcceptance(proposalRumor: JsRumor, statusRumor: JsRumor, providerPubkey: string): JsAcceptanceCheck;
export declare class JsAcceptanceCheck {
    private constructor();
    get kind(): string;
    get accepted(): boolean;
    get orderIdHex(): Nullable<string>;
    get provider(): Nullable<string>;
    get terms(): Nullable<JsOrderTerms>;
    get divergentTerms(): Array<string>;
    get claimedStatus(): Nullable<string>;
    get claimedStatusToken(): Nullable<string>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsServedBytesResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get servedBytesLength(): Nullable<string>;
    get maxServedBytes(): Nullable<string>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsOrderMachine {
    constructor(environment?: JsEnvironment, releaseTimeoutSeconds?: Nullable<string>, verificationTimeoutSeconds?: Nullable<string>);
    get environment(): JsEnvironment;
    get releaseTimeoutSeconds(): Nullable<string>;
    get verificationTimeoutSeconds(): Nullable<string>;
    toString(): string;
}
export declare class JsOrder {
    private constructor();
    get idHex(): string;
    get state(): string;
    get stateToken(): Nullable<string>;
    get terminal(): boolean;
    get recognised(): boolean;
    get priceMsat(): string;
    get feeMsat(): string;
    get totalMsat(): string;
    get feeBasisPoints(): Nullable<number>;
    get feePayeeRequired(): boolean;
    get expirationSeconds(): Nullable<string>;
    get deliverBySeconds(): Nullable<string>;
    get provider(): Nullable<string>;
    get commitment(): Nullable<JsCommitment>;
    get paidAtSeconds(): Nullable<string>;
    get releasedAtSeconds(): Nullable<string>;
    get disputeGround(): Nullable<string>;
    get paymentChecksPerformed(): Array<string>;
    get paymentChecksNotPerformedHere(): Array<string>;
    get deliveryChecksPerformed(): Array<string>;
    get deliveryChecksNotPerformedHere(): Array<string>;
    toString(): string;
}
export declare class JsOrderResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get order(): Nullable<JsOrder>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsOrderOutcome {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get order(): Nullable<JsOrder>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    get missingChecks(): Array<string>;
    toString(): string;
}
export declare class JsOrderEvent {
    constructor(type: string, createdAtSeconds?: Nullable<string>, orderIdHex?: Nullable<string>, terms?: Nullable<JsOrderTerms>, statusToken?: Nullable<string>, fromParty?: Nullable<string>, commitment?: Nullable<JsCommitment>, release?: Nullable<JsRelease>, proposalRumor?: Nullable<JsRumor>, acceptanceRumor?: Nullable<JsRumor>, providerPubkey?: Nullable<string>, requests?: Array<JsAcceptedRequest>, settlements?: Array<JsSettlement>, servedBytesHex?: Nullable<string>, plaintextBytesHex?: Nullable<string>, maxServedBytes?: Nullable<string>, deliveryFailure?: Nullable<string>);
    get type(): string;
    get createdAtSeconds(): Nullable<string>;
    get orderIdHex(): Nullable<string>;
    get terms(): Nullable<JsOrderTerms>;
    get statusToken(): Nullable<string>;
    get fromParty(): Nullable<string>;
    get commitment(): Nullable<JsCommitment>;
    get release(): Nullable<JsRelease>;
    get proposalRumor(): Nullable<JsRumor>;
    get acceptanceRumor(): Nullable<JsRumor>;
    get providerPubkey(): Nullable<string>;
    get requests(): Array<JsAcceptedRequest>;
    get settlements(): Array<JsSettlement>;
    get servedBytesHex(): Nullable<string>;
    get plaintextBytesHex(): Nullable<string>;
    get maxServedBytes(): Nullable<string>;
    get deliveryFailure(): Nullable<string>;
    toString(): string;
}
export declare class JsDecryption {
    constructor(ok: boolean, plaintext?: Nullable<string>);
    get ok(): boolean;
    get plaintext(): Nullable<string>;
    toString(): string;
}
export declare class JsSigner {
    constructor(publicKeyHex: () => Nullable<string>, signEvent: (p0: string) => Nullable<string>, nip44Encrypt: (p0: string, p1: string) => Nullable<string>, nip44Decrypt: (p0: string, p1: string) => Nullable<JsDecryption>);
    get publicKeyHex(): () => Nullable<string>;
    get signEvent(): (p0: string) => Nullable<string>;
    get nip44Encrypt(): (p0: string, p1: string) => Nullable<string>;
    get nip44Decrypt(): (p0: string, p1: string) => Nullable<JsDecryption>;
    toString(): string;
}
export declare class JsEnvironment {
    constructor(nowSeconds?: Nullable<() => Nullable<string>>, randomBytesHex?: Nullable<(p0: number) => Nullable<string>>, verifySchnorr?: Nullable<(p0: string, p1: string, p2: string) => Nullable<string>>, freshSigner?: Nullable<() => Nullable<JsSigner>>);
    get nowSeconds(): Nullable<() => Nullable<string>>;
    get randomBytesHex(): Nullable<(p0: number) => Nullable<string>>;
    get verifySchnorr(): Nullable<(p0: string, p1: string, p2: string) => Nullable<string>>;
    get freshSigner(): Nullable<() => Nullable<JsSigner>>;
    toString(): string;
}
export declare function verifySettlement(receipt: JsRumor, store: JsPaymentRequestStore, terms: JsOrderTerms): JsSettlementResult;
export declare function verifyFeeReceipt(receipt: JsRumor, store: JsPaymentRequestStore, order: JsOrder, earlierPoints?: Array<JsFeeTermSighting>): JsSettlementResult;
export declare function acceptPaymentRequest(request: JsRumor, proposalRumor: JsRumor, acceptanceRumor: JsRumor, providerPubkey: string, store: JsPaymentRequestStore, environment?: JsEnvironment, earlierPoints?: Array<JsFeeTermSighting>): JsAcceptedRequestResult;
export declare class JsSettlement {
    private constructor();
    get orderIdHex(): string;
    get payee(): string;
    get medium(): string;
    get evidenced(): boolean;
    get paymentHashHex(): Nullable<string>;
    get checksPerformed(): Array<string>;
    get checksNotPerformedHere(): Array<string>;
    toString(): string;
}
export declare class JsSettlementResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get settlement(): Nullable<JsSettlement>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsAcceptedRequest {
    private constructor();
    get orderIdHex(): string;
    get payee(): string;
    get invoice(): string;
    get acceptedAtSeconds(): string;
    get sealedBy(): string;
    toString(): string;
}
export declare class JsAcceptedRequestResult {
    private constructor();
    get kind(): string;
    get ok(): boolean;
    get request(): Nullable<JsAcceptedRequest>;
    get reason(): Nullable<string>;
    get reasonVocabulary(): Nullable<string>;
    get tag(): Nullable<string>;
    get detail(): Nullable<string>;
    toString(): string;
}
export declare class JsPaymentRequestStore {
    constructor(find?: Nullable<(p0: string, p1: string) => Nullable<JsAcceptedRequest>>, store?: Nullable<(p0: JsAcceptedRequest) => void>);
    get find(): Nullable<(p0: string, p1: string) => Nullable<JsAcceptedRequest>>;
    get store(): Nullable<(p0: JsAcceptedRequest) => void>;
    toString(): string;
}
export declare class JsFeeTermSighting {
    constructor(point: string, feeTag?: Nullable<Array<string>>);
    get point(): string;
    get feeTag(): Nullable<Array<string>>;
    toString(): string;
}