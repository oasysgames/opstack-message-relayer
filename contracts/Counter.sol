// SPDX-License-Identifier: MIT
pragma solidity ^0.8.17;

contract Counter {
    uint public count;
    mapping(bytes32 => uint256) private trash;

    constructor(uint _count) {
        count = _count;
    }

    // Function to get the current count
    function get() public view returns (uint) {
        return count;
    }

    // Function to increment count by 1, and waste gas
    function inc() public {
        count += 1;

        // waste gas
        bytes32 seed = keccak256(abi.encode(count));
        for (uint8 i = 0; i < 25; i++) {
            seed = keccak256(abi.encode(seed));
            trash[seed] = get();
        }
    }

    // Function to just simply increment count by 1
    function incSimple() public {
        count += 1;
    }

    // Function to decrement count by 1
    function dec() public {
        // This function will fail if count = 0
        count -= 1;
    }

    // Function to revert
    function revertFunc() public {
        revert("revert messasge abc");
    }
}
