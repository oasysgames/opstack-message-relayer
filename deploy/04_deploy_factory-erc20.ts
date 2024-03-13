import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { DeployFunction } from 'hardhat-deploy/types'

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployments, getNamedAccounts } = hre
  const { deploy } = deployments

  const { deployer } = await getNamedAccounts()

  await deploy('OptimismMintableERC20Factory', {
    from: deployer,
    args: ['0x4200000000000000000000000000000000000010'],
    waitConfirmations: 1,
    log: true,
    autoMine: true,
  })
}
export default func
func.tags = ['factory-erc20']
