//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.7;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';

// Used for minting test ERC20s in our tests
contract MockNFTL1 is ERC721 {
  uint256 public tokenId;

  constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

  function batchMint(uint256 amount, address to) external {
    for (uint256 i = 0; i < amount; i++) {
      _mint(to, tokenId);
      tokenId++;
    }
  }
}
