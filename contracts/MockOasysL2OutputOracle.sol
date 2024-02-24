// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "./IOasysL2OutputOracle.sol";

contract MockOasysL2OutputOracle is IOasysL2OutputOracle {
    uint128 public immutable L1_TIMESTAMP;

    constructor() {
        L1_TIMESTAMP = uint128(block.timestamp);
    }

    function verifiedL1Timestamp() public override view returns (uint128) {
        return L1_TIMESTAMP;
    }
}
