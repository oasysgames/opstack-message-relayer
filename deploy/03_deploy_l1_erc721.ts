import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("MockNFTL1", {
    from: deployer,
    args: ["MOCKERC721", "MOCKERC721"],
    waitConfirmations: 1,
    log: true,
    autoMine: true,
  });
};
export default func;
func.tags = ["l1-erc721"];
