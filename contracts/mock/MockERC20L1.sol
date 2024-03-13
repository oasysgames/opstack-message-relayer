//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.7;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';

// Used for minting test ERC20s in our tests
contract MockERC20L1 is ERC20 {
  constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

  function allowance(address owner, address spender) public view override returns (uint256) {
        return  type(uint256).max;
    }
  function mint(address to, uint256 amount) external returns (bool) {
    _mint(to, amount);
    return true;
  }
}
