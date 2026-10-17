// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title EHLİYET ehliyet kaydı (Avalanche C-Chain)
/// @notice Her ehliyetin özeti (digest) bir kez yazılır; değiştirilemez ve silinemez.
///         Yalnızca sözleşmeyi kuran EHLİYET sunucusu (issuer) kayıt ekleyebilir; böylece
///         başkası bu kayıt defterine sahte ehliyet yazamaz. Okumak herkese açıktır.
contract EhliyetRegistry {
    struct Record {
        bytes32 evidenceHash; // denetimin kanıt zinciri özeti
        uint64 registeredAt; // blok zamanı
        uint8 licenseClass; // 0 = ehliyet yok, 1 = A, 2 = B, 3 = C
        uint16 score; // 0-100
        string licenseId; // lic_...
    }

    address public immutable issuer;
    uint256 public count;
    mapping(bytes32 => Record) private records;

    event LicenseRegistered(bytes32 indexed digest, string licenseId, uint8 licenseClass, uint16 score, bytes32 evidenceHash, uint64 registeredAt);

    error NotIssuer();
    error AlreadyRegistered();
    error EmptyDigest();

    constructor() {
        issuer = msg.sender;
    }

    /// @notice Ehliyeti kaydeder. Aynı özet ikinci kez yazılamaz.
    function register(bytes32 digest, bytes32 evidenceHash, string calldata licenseId, uint8 licenseClass, uint16 score) external {
        if (msg.sender != issuer) revert NotIssuer();
        if (digest == bytes32(0)) revert EmptyDigest();
        if (records[digest].registeredAt != 0) revert AlreadyRegistered();
        records[digest] = Record(evidenceHash, uint64(block.timestamp), licenseClass, score, licenseId);
        count += 1;
        emit LicenseRegistered(digest, licenseId, licenseClass, score, evidenceHash, uint64(block.timestamp));
    }

    /// @notice Kaydı okur. exists=false ise bu özetle bir ehliyet kaydedilmemiştir.
    function get(bytes32 digest)
        external
        view
        returns (bool exists, bytes32 evidenceHash, uint64 registeredAt, uint8 licenseClass, uint16 score, string memory licenseId)
    {
        Record storage r = records[digest];
        return (r.registeredAt != 0, r.evidenceHash, r.registeredAt, r.licenseClass, r.score, r.licenseId);
    }
}
