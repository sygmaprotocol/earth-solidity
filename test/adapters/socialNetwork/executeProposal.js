// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");
const Helpers = require("../../helpers");

const ERC20MintableContract = artifacts.require("ERC20PresetMinterPauser");
const PermissionlessGenericHandlerContract = artifacts.require(
  "PermissionlessGenericHandler"
);
const SocialAdapterContract = artifacts.require("SocialNetworkAdapter");
const SocialNetworkPercentageFeeHandlerContract = artifacts.require("SocialNetworkPercentageFeeHandler");
const SocialNetworkControllerMockContract = artifacts.require("SocialNetworkControllerMock");

contract(
  "PermissionlessGenericHandler - Social network - [execute proposal]",
  async (accounts) => {
    const originDomainID = 1;
    const destinationDomainID = 2;
    const expectedDepositNonce = 1;

    const ethDepositorAddress = accounts[1];
    const relayer1Address = accounts[2];

    const destinationMaxFee = 900000;
    const depositAmount = 500;
    const feeBps = 60000; // BPS
    const fee = 120;
    const lowerBound = 100;
    const upperBound = 300;


    let BridgeInstance;
    let SocialNetworkAdapterInstance;
    let SocialNetworkControllerMockInstance;
    let ERC20MintableInstance;
    let SocialNetworkPercentageFeeHandlerInstance;
    let PermissionlessGenericHandlerInstance;

    let resourceID;
    let depositFunctionSignature;

    beforeEach(async () => {
      await Promise.all([
        (BridgeInstance = await Helpers.deployBridge(
          destinationDomainID,
          accounts[0]
        )),
        (ERC20MintableInstance = ERC20MintableContract.new(
          "ERC20Token",
          "ERC20TOK"
        ).then((instance) => (ERC20MintableInstance = instance))),
      ]);

      resourceID = Helpers.createResourceID(
        ERC20MintableInstance.address,
        originDomainID
      );

      PermissionlessGenericHandlerInstance =
        await PermissionlessGenericHandlerContract.new(BridgeInstance.address);

      SocialNetworkPercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
      await SocialNetworkPercentageFeeHandlerInstance.setSocialNetworkBitcoinAddress(ERC20MintableInstance.address)

      SocialNetworkControllerMockInstance = await SocialNetworkControllerMockContract.new();
      SocialNetworkAdapterInstance = await SocialAdapterContract.new(
        PermissionlessGenericHandlerInstance.address,
          SocialNetworkPercentageFeeHandlerInstance.address,
          SocialNetworkControllerMockInstance.address,
        );

      await Promise.all([
        ERC20MintableInstance.grantRole(
          await ERC20MintableInstance.MINTER_ROLE(),
          SocialNetworkControllerMockInstance.address
        ),
        ERC20MintableInstance.mint(ethDepositorAddress, depositAmount + fee),
        ERC20MintableInstance.approve(SocialNetworkPercentageFeeHandlerInstance.address, fee, {
          from: ethDepositorAddress,
        }),
        BridgeInstance.adminChangeFeeHandler(SocialNetworkPercentageFeeHandlerInstance.address),
      ]);

      await SocialNetworkPercentageFeeHandlerInstance.changeFee(feeBps);
      await SocialNetworkPercentageFeeHandlerInstance.changeFeeBounds(lowerBound, upperBound);

      depositFunctionSignature = Helpers.getFunctionSignature(
        SocialNetworkAdapterInstance,
        "stakeBTC"
      );

      const PermissionlessGenericHandlerSetResourceData =
        Helpers.constructGenericHandlerSetResourceData(
          depositFunctionSignature,
          Helpers.blankFunctionDepositorOffset,
          Helpers.blankFunctionSig
        );
      await BridgeInstance.adminSetResource(
        PermissionlessGenericHandlerInstance.address,
        resourceID,
        SocialNetworkAdapterInstance.address,
        PermissionlessGenericHandlerSetResourceData
      );

      // set MPC address to unpause the Bridge
      await BridgeInstance.endKeygen(Helpers.mpcAddress);
    });

    it("[sanity] should fail if stakeBTC is not called from Permissionless Generic handler", async () => {
      await TruffleAssert.reverts(
        SocialNetworkAdapterInstance.stakeBTC(ethDepositorAddress, "0x"),
        "sender must be GMP contract"
      );
    });

    it("call with packed depositData should be successful", async () => {
      const btcDepositorAddress = "btcDepositorAddress"
      const executionData = Helpers.abiEncode(["uint", "string"], [depositAmount, btcDepositorAddress]);

      // this mocks prepareDepositData helper function from origin adapter
      // this logic is now on implemented on relayers
      const preparedExecutionData =
        "0x" +
        Helpers.abiEncode(
          ["address", "bytes"], [Ethers.constants.AddressZero, executionData]
        ).slice(66);

        await SocialNetworkControllerMockInstance.setSocialNetworkBitcoinAddress(ERC20MintableInstance.address);

      const depositFunctionSignature = Helpers.getFunctionSignature(
        SocialNetworkAdapterInstance,
        "stakeBTC"
      );
      const depositData = Helpers.createPermissionlessGenericDepositData(
        depositFunctionSignature,
        SocialNetworkAdapterInstance.address,
        destinationMaxFee,
        ethDepositorAddress,
        preparedExecutionData
      );

      const proposal = {
        originDomainID: originDomainID,
        depositNonce: expectedDepositNonce,
        data: depositData,
        resourceID: resourceID,
      };
      const proposalSignedData = await Helpers.signTypedProposal(
        BridgeInstance.address,
        [proposal]
      );

      // relayer1 executes the proposal
      const executeTx = await BridgeInstance.executeProposal(proposal, proposalSignedData, {
        from: relayer1Address,
      });

      const internalTx = await TruffleAssert.createTransactionResult(
        SocialNetworkControllerMockInstance,
        executeTx.tx
      );

      // check that ProposalExecution event is emitted
      TruffleAssert.eventEmitted(executeTx, "ProposalExecution", (event) => {
        return (
          event.originDomainID.toNumber() === originDomainID &&
          event.depositNonce.toNumber() === expectedDepositNonce
        );
      });

      // check that TestExecute event is emitted
      TruffleAssert.eventEmitted(internalTx, "Stake", (event) => {
        return (
          event.user === ethDepositorAddress &&
          // this is for Social network internal logic
          // 369 Social Network Bitcoin (HEART) for every Bitcoin (SAT) deposited
          event.amount.toNumber() === depositAmount * 369
        );
      });

      // check that deposit amount is mapped to belonging address
      assert.equal(
        (await SocialNetworkAdapterInstance._btcToEthDepositorToStakedAmount.call(
          btcDepositorAddress,
          ethDepositorAddress
        )).toString(),
        depositAmount - lowerBound
      )

      // check that fee token amount is minted to fee handler
      assert.equal(
        (await ERC20MintableInstance.balanceOf(SocialNetworkPercentageFeeHandlerInstance.address)),
        lowerBound
      )
    });
  }
);
