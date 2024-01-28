// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IOasysPortal {
    /// @notice Struct representing a withdrawal transaction.
    /// @custom:field nonce    Nonce of the withdrawal transaction
    /// @custom:field sender   Address of the sender of the transaction.
    /// @custom:field target   Address of the recipient of the transaction.
    /// @custom:field value    Value to send to the recipient.
    /// @custom:field gasLimit Gas limit of the transaction.
    /// @custom:field data     Data of the transaction.
    struct WithdrawalTransaction {
        uint256 nonce;
        address sender;
        address target;
        uint256 value;
        uint256 gasLimit;
        bytes data;
    }

    function finalizeWithdrawalTransaction(WithdrawalTransaction calldata _tx) external;

    function finalizeWithdrawalTransactions(WithdrawalTransaction[] calldata _txs) external;

    function finalizedWithdrawals(bytes32 withdrawalHash) external view returns (bool);
}
