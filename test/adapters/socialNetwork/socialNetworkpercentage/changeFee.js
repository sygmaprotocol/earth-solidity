// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

const TruffleAssert = require("truffle-assertions");
const Ethers = require("ethers");

const Helpers = require("../../../helpers");

const ERC20MintableContract = artifacts.require("ERC20PresetMinterPauser");
const PermissionlessGenericHandlerContract = artifacts.require(
  "PermissionlessGenericHandler"
);
const SocialAdapterContract = artifacts.require("SocialNetworkAdapter");
const SocialNetworkPercentageFeeHandlerContract = artifacts.require("SocialNetworkPercentageFeeHandler");
const SocialNetworkControllerMockContract = artifacts.require("SocialNetworkControllerMock");


contract("SocialNetworkPercentageFeeHandler - [change fee and bounds]", async (accounts) => {
  const originDomainID = 1;
  const destinationDomainID = 2;
  const nonAdmin = accounts[1];

  let BridgeInstance;
  let SocialNetworkAdapterInstance;
  let SocialNetworkControllerMockInstance;
  let ERC20MintableInstance;
  let SocialNetworkPercentageFeeHandlerInstance;
  let PermissionlessGenericHandlerInstance;

  let resourceID;
  let depositFunctionSignature;

  const assertOnlyAdmin = (method, ...params) => {
    return TruffleAssert.reverts(
      method(...params, {from: nonAdmin}),
      "sender doesn't have admin role"
    );
  };

  beforeEach(async () => {
    await Promise.all([
      (BridgeInstance = await Helpers.deployBridge(
        destinationDomainID,
        accounts[0]
      )),
      ERC20MintableContract.new("token", "TOK").then(
        (instance) => (ERC20MintableInstance = instance)
      ),
    ]);
    SocialNetworkPercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await SocialNetworkPercentageFeeHandlerInstance.setSocialNetworkBitcoinAddress(ERC20MintableInstance.address)

    PermissionlessGenericHandlerInstance =
    await PermissionlessGenericHandlerContract.new(BridgeInstance.address);

    SocialNetworkControllerMockInstance = await SocialNetworkControllerMockContract.new();
    SocialNetworkAdapterInstance = await SocialAdapterContract.new(
      PermissionlessGenericHandlerInstance.address,
        SocialNetworkPercentageFeeHandlerInstance.address,
        SocialNetworkControllerMockInstance.address,
      );

    depositFunctionSignature = Helpers.getFunctionSignature(
      SocialNetworkAdapterInstance,
      "stakeBTC"
    );

    resourceID = Helpers.createResourceID(
      ERC20MintableInstance.address,
      originDomainID
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
  });

  it("[sanity] contract should be deployed successfully", async () => {
    TruffleAssert.passes(
      await SocialNetworkPercentageFeeHandlerContract.new()
    );
  });

  it("should set fee", async () => {
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    const fee = Ethers.utils.parseUnits("25");
    const tx = await PercentageFeeHandlerInstance.changeFee(fee);
    TruffleAssert.eventEmitted(
      tx,
      "FeeChanged",
      (event) => {
        return Ethers.utils.formatUnits(event.newFee.toString()) === "25.0"
      }
    );
    const newFee = await PercentageFeeHandlerInstance._fee.call();
    assert.equal(Ethers.utils.formatUnits(newFee.toString()), "25.0");
  });

  it("should not set the same fee", async () => {
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await TruffleAssert.reverts(
      PercentageFeeHandlerInstance.changeFee(0),
      "Current fee is equal to new fee"
    );
  });

  it("should require admin role to change fee", async () => {
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await assertOnlyAdmin(PercentageFeeHandlerInstance.changeFee, 1);
  });

  it("should set fee bounds", async () => {
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    const tx = await PercentageFeeHandlerInstance.changeFeeBounds(50, 100);
    TruffleAssert.eventEmitted(
      tx,
      "FeeBoundsChanged",
      (event) => {
        return event.newLowerBound.toString() === "50" &&
        event.newUpperBound.toString() === "100"
      }
    );
    const newLowerBound = (await PercentageFeeHandlerInstance._feeBounds.call()).lowerBound
    const newUpperBound = (await PercentageFeeHandlerInstance._feeBounds.call()).upperBound
    assert.equal(newLowerBound.toString(), "50");
    assert.equal(newUpperBound.toString(), "100");
  });

  it("should not set the same fee bounds", async () => {
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await PercentageFeeHandlerInstance.changeFeeBounds(25, 50)
    await TruffleAssert.reverts(
      PercentageFeeHandlerInstance.changeFeeBounds(25, 50),
      "Current bounds are equal to new bounds"
    );
  });

  it("should fail to set lower bound larger than upper bound ", async () => {
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await TruffleAssert.reverts(
      PercentageFeeHandlerInstance.changeFeeBounds(50, 25),
      "Upper bound must be larger than lower bound or 0"
    );
  });

  it("should set only lower bound", async () => {
    const newLowerBound = 30;
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await PercentageFeeHandlerInstance.changeFeeBounds(25, 50);
    await PercentageFeeHandlerInstance.changeFeeBounds(newLowerBound, 50);
    const currentLowerBound = (await PercentageFeeHandlerInstance._feeBounds.call()).lowerBound;
    assert.equal(currentLowerBound, newLowerBound);
  });

  it("should set only upper bound", async () => {
    const newUpperBound = 100;
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await PercentageFeeHandlerInstance.changeFeeBounds(25, 50);
    await PercentageFeeHandlerInstance.changeFeeBounds(25, newUpperBound);
    const currentUpperBound = (await PercentageFeeHandlerInstance._feeBounds.call()).upperBound;
    assert.equal(newUpperBound, currentUpperBound);
  });

  it("should require admin role to change fee bunds", async () => {
    const PercentageFeeHandlerInstance = await SocialNetworkPercentageFeeHandlerContract.new();
    await assertOnlyAdmin(PercentageFeeHandlerInstance.changeFeeBounds, 50, 100);
  });
});
