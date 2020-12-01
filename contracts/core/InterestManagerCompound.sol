// SPDX-License-Identifier: MIT
pragma solidity ^0.6.9;

import "./interfaces/IInterestManager.sol";
import "../util/Ownable.sol";
import "../compound/ICToken.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../util/Initializable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

/**
 * @title InterestManagerCompound
 * @author Alexander Schlindwein
 * 
 * Invests DAI into Compound to generate interest
 * Sits behind an AdminUpgradabilityProxy 
 */
contract InterestManagerCompound is Ownable, Initializable {

    using SafeMath for uint;

    IERC20 private _dai;
    ICToken private _cDai;
    IERC20 private _comp;
    address private _compRecipient;

    mapping(address => uint) _donatedDai;

    /**
     * Initializes the contract with all required values
     *
     * @param owner The owner of the contract
     * @param dai The Dai token address
     * @param cDai The cDai token address
     * @param comp The Comp token address
     * @param compRecipient The address of the recipient of the Comp tokens
     */
    function initialize(address owner, address dai, address cDai, address comp, address compRecipient) external initializer {
        setOwnerInternal(owner);
        _dai = IERC20(dai);
        _cDai = ICToken(cDai);
        _comp = IERC20(comp);
        _compRecipient = compRecipient;
    }

    /**
     * Invests a given amount of Dai into Compound
     * The Dai have to be transfered to this contract before this function is called
     *
     * @param amount The amount of Dai to invest
     *
     * @return The amount of minted cDai
     */
    function invest(uint amount) public returns (uint) {
        uint balanceBefore = _cDai.balanceOf(address(this));
        require(_dai.balanceOf(address(this)) >= amount, "invest: not enough dai");
        require(_dai.approve(address(_cDai), amount), "invest: dai approve cDai failed");
        require(_cDai.mint(amount) == 0, "invest: cDai mint failed");
        uint balanceAfter = _cDai.balanceOf(address(this));
        return balanceAfter.sub(balanceBefore);
    }

    /**
     * Checks that the caller is the owner and delegates to redeemInternal
     *
     * @return The amount of burned cDai
     */
    function redeem(address recipient, uint amount) external onlyOwner returns (uint) {
        return redeemInternal(recipient, amount);
    }

    /**
     * Redeems a given amount of Dai from Compound and sends it to the recipient
     *
     * @param recipient The recipient of the redeemed Dai
     * @param amount The amount of Dai to redeem
     *
     * @return The amount of burned cDai
     */
    function redeemInternal(address recipient, uint amount) internal returns (uint) {
        uint balanceBefore = _cDai.balanceOf(address(this));
        require(_cDai.redeemUnderlying(amount) == 0, "redeem: failed to redeem");
        uint balanceAfter = _cDai.balanceOf(address(this));
        require(_dai.transfer(recipient, amount), "redeem: dai transfer failed");
        return balanceBefore.sub(balanceAfter);
    }

    /**
     * Redeems a given amount of cDai from Compound and sends Dai to the recipient
     *
     * @param recipient The recipient of the redeemed Dai
     * @param amount The amount of cDai to redeem
     *
     * @return The amount of redeemed Dai
     */
    function redeemInvestmentToken(address recipient, uint amount) external onlyOwner returns (uint) {
        uint balanceBefore = _dai.balanceOf(address(this));
        require(_cDai.redeem(amount) == 0, "redeemInvestmentToken: failed to redeem");
        uint redeemed = _dai.balanceOf(address(this)).sub(balanceBefore);
        require(_dai.transfer(recipient, redeemed), "redeemInvestmentToken: failed to transfer");
        return redeemed;
    }

    /**
     * Accepts donated Dai and invests into Compound to generate interest
     *
     * @param amount The amount of Dai to donate
     */
    function donateInterest(uint amount) external {
        require(_dai.allowance(msg.sender, address(this)) >= amount, "donateInterest: not enough allowance");
        require(_dai.transferFrom(msg.sender, address(this), amount), "donateInterest: dai transfer failed");
        _donatedDai[msg.sender] = _donatedDai[msg.sender].add(amount);
        invest(amount);
    }

    /**
     * Redeems donated Dai back to the donator without generated interest
     *
     * @param amount The amount of Dai to redeem
     */
    function redeemDonated(uint amount) external {
        require(_donatedDai[msg.sender] >= amount, "redeemDonated: not enough donated");
        _donatedDai[msg.sender] = _donatedDai[msg.sender].sub(amount);
        redeemInternal(msg.sender, amount);
    }

    /**
     * Updates accrued interest on the invested Dai
     */
    function accrueInterest() external {
        require(_cDai.accrueInterest() == 0, "accrueInterest: failed to accrue interest");
    }

    /**
     * Withdraws the generated Comp tokens to the Comp recipient
     */
    function withdrawComp() external {
        require(_comp.transfer(_compRecipient, _comp.balanceOf(address(this))), "redeemComp: transfer failed");
    }

    /**
     * Converts an amount of underlying tokens to an amount of investment tokens
     *
     * @param underlyingAmount The amount of underlying tokens
     *
     * @return The amount of investment tokens
     */
    function underlyingToInvestmentToken(uint underlyingAmount) external view returns (uint) {
        return divScalarByExpTruncate(underlyingAmount, _cDai.exchangeRateStored());
    }

    /**
     * Converts an amount of investment tokens to an amount of underlying tokens
     *
     * @param investmentTokenAmount The amount of investment tokens
     *
     * @return The amount of underlying tokens
     */
    function investmentTokenToUnderlying(uint investmentTokenAmount) external view returns (uint) {
        return mulScalarTruncate(investmentTokenAmount, _cDai.exchangeRateStored());
    }

    // ====================================== COMPOUND MATH ======================================
    // https://github.com/compound-finance/compound-protocol/blob/master/contracts/Exponential.sol
    //
    // Modified to revert instead of returning an error code

    function mulScalarTruncate(uint a, uint scalar) pure internal returns (uint) {
        uint product = mulScalar(a, scalar);
        return truncate(product);
    }

    function mulScalar(uint a, uint scalar) pure internal returns (uint) {
        return a.mul(scalar);
    }

    function divScalarByExpTruncate(uint scalar, uint divisor) pure internal returns (uint) {
        uint fraction = divScalarByExp(scalar, divisor);
        return truncate(fraction);
    }

    function divScalarByExp(uint scalar, uint divisor) pure internal returns (uint) {
        uint numerator = uint(10**18).mul(scalar);
        return getExp(numerator, divisor);
    }

    function getExp(uint num, uint denom) pure internal returns (uint) {
        uint scaledNumerator = num.mul(10**18);
        return scaledNumerator.div(denom);
    }

    function truncate(uint num) pure internal returns (uint) {
        return num / 10**18;
    }

}