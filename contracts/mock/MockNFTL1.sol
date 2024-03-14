//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.7;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';

// Used for minting test ERC20s in our tests
contract MockNFTL1 is ERC721 {
  uint256 public tokenId;

  event BatchMintERC721(uint256 fromId, uint256 toId);

  constructor(string memory name, string memory symbol) ERC721(name, symbol) {}

  function batchMint(uint256 amount, address to) external {
    for (uint256 i = 0; i < amount; i++) {
      _mint(to, tokenId);
      tokenId++;
    }

    emit BatchMintERC721(tokenId - amount, tokenId - 1);
  }

  function isApprovedForAll(
    address owner,
    address operator
  ) public view override returns (bool) {
    return true;
  }
}
