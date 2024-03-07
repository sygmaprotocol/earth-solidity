// The Licensed Work is (c) 2022 Sygma
// SPDX-License-Identifier: LGPL-3.0-only

const Helpers = require("../../../helpers");

const ERC20MintableContract = artifacts.require("ERC20PresetMinterPauser");
const PermissionlessGenericHandlerContract = artifacts.require(
  "PermissionlessGenericHandler"
);
const SocialAdapterContract = artifacts.require("SocialNetworkAdapter");
const SocialNetworkPercentageFeeHandlerContract = artifacts.require("SocialNetworkPercentageFeeHandler");
const SocialNetworkControllerMockContract = artifacts.require("SocialNetworkControllerMock");

contract("SocialNetworkPercentageFeeHandler - [calculateFee]", async (accounts) => {
  const originDomainID = 1;
  const destinationDomainID = 2;

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

  it(`should return percentage of token amount for fee if bounds
      are set [lowerBound > 0, upperBound > 0]`, async () => {
    const depositAmount = 100000000;

    // current fee is set to 0
    let fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );

    assert.equal(fee.toString(), "0");
    // Change fee to 1 BPS ()
    await SocialNetworkPercentageFeeHandlerInstance.changeFee(10000);
    await SocialNetworkPercentageFeeHandlerInstance.changeFeeBounds(100, 300000);
    fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );
    assert.equal(fee.toString(), "10000");
  });

  it(`should return percentage of token amount for fee if bounds
      are not set [lowerBound = 0, upperBound = 0]`, async () => {
    const depositAmount = 100000000;

    // current fee is set to 0
    let fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );

    assert.equal(fee.toString(), "0");
    // Change fee to 1 BPS ()
    await SocialNetworkPercentageFeeHandlerInstance.changeFee(10000);
    fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );
    assert.equal(fee.toString(), "10000");
  });

  it("should return lower bound token amount for fee [lowerBound > 0, upperBound > 0]", async () => {
    const depositAmount = 10000;
    await SocialNetworkPercentageFeeHandlerInstance.changeFeeBounds(100, 300);
    await SocialNetworkPercentageFeeHandlerInstance.changeFee(10000);

    fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );
    assert.equal(fee.toString(), "100");
  });

  it("should return lower bound token amount for fee [lowerBound > 0, upperBound = 0]", async () => {
    const depositAmount = 10000;
    await SocialNetworkPercentageFeeHandlerInstance.changeFeeBounds(100, 0);
    await SocialNetworkPercentageFeeHandlerInstance.changeFee(10000);

    fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );
    assert.equal(fee.toString(), "100");
  });

  it("should return upper bound token amount for fee [lowerBound = 0, upperBound > 0]", async () => {
    const depositAmount = 100000000;
    await SocialNetworkPercentageFeeHandlerInstance.changeFeeBounds(0, 300);
    await SocialNetworkPercentageFeeHandlerInstance.changeFee(10000);

    fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );
    assert.equal(fee.toString(), "300");
  });

  it("should return percentage of token amount for fee [lowerBound = 0, upperBound > 0]", async () => {
    const depositAmount = 100000;
    await SocialNetworkPercentageFeeHandlerInstance.changeFeeBounds(0, 300);
    await SocialNetworkPercentageFeeHandlerInstance.changeFee(10000);

    fee = await SocialNetworkPercentageFeeHandlerInstance.calculateFee.call(
      depositAmount,
    );
    assert.equal(fee.toString(), "10");
  });
});
