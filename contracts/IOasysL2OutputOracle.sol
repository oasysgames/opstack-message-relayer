// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IOasysL2OutputOracle {
    function verifiedL1Timestamp() external view returns (uint128);
}
