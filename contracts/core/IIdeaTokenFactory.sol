// SPDX-License-Identifier: MIT
pragma solidity ^0.6.9;
pragma experimental ABIEncoderV2;

import "./IIdeaToken.sol";
import "./IIdeaTokenNameVerifier.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IIdeaTokenFactory {
    struct TokenInfo {
        bool exists;
        uint id;
        string name;
        IIdeaToken ideaToken;
    }

    /// @dev Stores information about a market
    struct MarketDetails {
        bool exists;
        uint id;
        string name;

        IIdeaTokenNameVerifier nameVerifier;
        uint numTokens;

        uint baseCost;
        uint priceRise;
        uint tokensPerInterval;
    }

    function isValidTokenName(string calldata tokenName, uint marketID) external view returns (bool);
    function getMarketDetailsByID(uint marketID) external view returns (MarketDetails memory);
    function getMarketDetailsByName(string calldata marketName) external view returns (MarketDetails memory);
    function getNumMarkets() external view returns (uint);
    function getTokenInfo(uint marketID, uint tokenID) external view returns (TokenInfo memory);
}