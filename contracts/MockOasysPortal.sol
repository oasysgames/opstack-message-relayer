// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./IOasysPortal.sol";

contract MockOasysPortal is IOasysPortal {
    mapping(bytes32 => bool) private _finalizedWithdrawals;
    mapping(bytes32 => uint256) private trash;

    function computeWithdrawalHash(bytes calldata data) public pure returns (bytes32) {
        return keccak256(abi.encode(data));
    }

    function finalizeWithdrawalTransaction(WithdrawalTransaction calldata _tx) public {
        bytes32 withdrawalHash = keccak256(abi.encode(_tx.data));
        require(!_finalizedWithdrawals[withdrawalHash], "Transaction already finalized");
        _finalizedWithdrawals[withdrawalHash] = true;

        // waste gas
        bytes32 seed = withdrawalHash;
        for (uint8 i = 0; i < 25; i++) {
            seed = keccak256(abi.encode(withdrawalHash));
            trash[seed] = _tx.value;
        }
    }

    function finalizeWithdrawalTransactions(WithdrawalTransaction[] calldata _txs) public {
        for (uint256 i = 0; i < _txs.length; i++) {
            finalizeWithdrawalTransaction(_txs[i]);
        }
    }

    function finalizedWithdrawals(bytes32 withdrawalHash) public view returns (bool) {
        return _finalizedWithdrawals[withdrawalHash];
    }
}
