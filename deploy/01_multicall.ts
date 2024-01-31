import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre;
  const { deploy } = deployments;

  const { deployer } = await getNamedAccounts();

  await deploy("Multicall2", {
    from: deployer,
    args: [],
    waitConfirmations: 1,
    log: true,
    autoMine: true,
  });
};
export default func;
func.tags = ["multicall"];
