// SPDX-License-Identifier: MIT
pragma solidity ^0.6.9;

import "../core/interfaces/IIdeaTokenExchange.sol";

/**
 * @title AuthorizeInterestWithdrawerSpell
 * @author Alexander Schlindwein
 *
 * Spell to authorize an interest withdrawer
 */
contract AuthorizeInterestWithdrawerSpell {

    /**
     * Authorizes an address to withdraw interest for an IdeaToken
     *
     * @param exchange The address of the IdeaTokenExchange
     * @param ideaToken The address of the IdeaToken for which to authorize an interest withdrawer
     * @param withdrawer The address of the withdrawer
     */
    function execute(address exchange, address ideaToken, address withdrawer) external {
        IIdeaTokenExchange(exchange).authorizeInterestWithdrawer(ideaToken, withdrawer);
    }
}