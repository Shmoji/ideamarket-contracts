const { expect } = require('chai')
const { BigNumber } = require('ethers')
const { ethers } = require('hardhat')

describe('core/MultiAction', () => {
	let DomainNoSubdomainNameVerifier
	let TestERC20
	let TestCDai
	let InterestManagerCompound
	let IdeaTokenFactory
	let IdeaTokenExchange
	let IdeaToken
	let TestWETH
	let TestTransferHelperLib
	let TestUniswapV2Lib
	let TestUniswapV2Factory
	let TestUniswapV2Router02
	let IdeaTokenVault
	let MultiAction

	const tenPow18 = BigNumber.from('10').pow(BigNumber.from('18'))

	const marketName = 'main'
	const tokenName = 'test.com'
	const baseCost = BigNumber.from('100000000000000000') // 10**17 = $0.1
	const priceRise = BigNumber.from('100000000000000') // 10**14 = $0.0001
	const hatchTokens = BigNumber.from('1000000000000000000000') // 10**21 = 1000
	const tradingFeeRate = BigNumber.from('100')
	const platformFeeRate = BigNumber.from('50')

	let userAccount
	let adminAccount
	let tradingFeeAccount
	const zeroAddress = '0x0000000000000000000000000000000000000000'

	let domainNoSubdomainNameVerifier
	let dai
	let comp
	let someToken
	let cDai
	let interestManagerCompound
	let ideaTokenFactory
	let ideaTokenExchange
	let weth
	let uniswapFactory
	let router
	let ideaTokenVault
	let multiAction

	let marketID
	let tokenID
	let ideaToken

	before(async () => {
		const accounts = await ethers.getSigners()
		userAccount = accounts[0]
		adminAccount = accounts[1]
		tradingFeeAccount = accounts[2]

		DomainNoSubdomainNameVerifier = await ethers.getContractFactory('DomainNoSubdomainNameVerifier')
		TestERC20 = await ethers.getContractFactory('TestERC20')
		TestCDai = await ethers.getContractFactory('TestCDai')
		InterestManagerCompound = await ethers.getContractFactory('InterestManagerCompound')
		IdeaTokenFactory = await ethers.getContractFactory('IdeaTokenFactory')
		IdeaTokenExchange = await ethers.getContractFactory('IdeaTokenExchange')
		IdeaToken = await ethers.getContractFactory('IdeaToken')
		TestWETH = await ethers.getContractFactory('TestWETH')
		TestTransferHelperLib = await ethers.getContractFactory('TestTransferHelper')
		TestUniswapV2Lib = await ethers.getContractFactory('TestUniswapV2Library')
		TestUniswapV2Factory = await ethers.getContractFactory('TestUniswapV2Factory')
		TestUniswapV2Router02 = await ethers.getContractFactory('TestUniswapV2Router02')
		IdeaTokenVault = await ethers.getContractFactory('IdeaTokenVault')
		MultiAction = await ethers.getContractFactory('MultiAction')
	})

	beforeEach(async () => {
		domainNoSubdomainNameVerifier = await DomainNoSubdomainNameVerifier.deploy()
		await domainNoSubdomainNameVerifier.deployed()

		dai = await TestERC20.deploy('DAI', 'DAI')
		await dai.deployed()
		comp = await TestERC20.deploy('COMP', 'COMP')
		await comp.deployed()

		someToken = await TestERC20.deploy('SOME', 'SOME')
		await someToken.deployed()

		cDai = await TestCDai.deploy(dai.address, comp.address)
		await cDai.deployed()
		await cDai.setExchangeRate(tenPow18)

		interestManagerCompound = await InterestManagerCompound.deploy()
		await interestManagerCompound.deployed()

		ideaTokenFactory = await IdeaTokenFactory.deploy()
		await ideaTokenFactory.deployed()

		ideaTokenExchange = await IdeaTokenExchange.deploy()
		await ideaTokenExchange.deployed()

		weth = await TestWETH.deploy('WETH', 'WETH')
		await weth.deployed()

		const transferHelperLib = await TestTransferHelperLib.deploy()
		await transferHelperLib.deployed()

		const uniswapV2Lib = await TestUniswapV2Lib.deploy()
		await uniswapV2Lib.deployed()

		uniswapFactory = await TestUniswapV2Factory.deploy(zeroAddress)
		await uniswapFactory.deployed()

		router = await TestUniswapV2Router02.deploy(uniswapFactory.address, weth.address)
		await router.deployed()

		ideaTokenVault = await IdeaTokenVault.deploy()
		await ideaTokenVault.deployed()

		multiAction = await MultiAction.deploy(
			ideaTokenExchange.address,
			ideaTokenFactory.address,
			ideaTokenVault.address,
			dai.address,
			router.address,
			weth.address
		)
		await multiAction.deployed()

		await interestManagerCompound
			.connect(adminAccount)
			.initialize(ideaTokenExchange.address, dai.address, cDai.address, comp.address, zeroAddress)

		await ideaTokenFactory.connect(adminAccount).initialize(adminAccount.address, ideaTokenExchange.address)

		await ideaTokenExchange
			.connect(adminAccount)
			.initialize(
				adminAccount.address,
				adminAccount.address,
				tradingFeeAccount.address,
				interestManagerCompound.address,
				dai.address
			)
		await ideaTokenExchange.connect(adminAccount).setIdeaTokenFactoryAddress(ideaTokenFactory.address)

		await ideaTokenFactory
			.connect(adminAccount)
			.addMarket(
				marketName,
				domainNoSubdomainNameVerifier.address,
				baseCost,
				priceRise,
				hatchTokens,
				tradingFeeRate,
				platformFeeRate
			)

		marketID = await ideaTokenFactory.getMarketIDByName(marketName)

		await ideaTokenFactory.addToken(tokenName, marketID)

		tokenID = await ideaTokenFactory.getTokenIDByName(tokenName, marketID)

		ideaToken = new ethers.Contract(
			(await ideaTokenFactory.getTokenInfo(marketID, tokenID)).ideaToken,
			IdeaToken.interface,
			IdeaToken.signer
		)

		await ideaTokenVault.initialize(ideaTokenFactory.address)

		// Setup Uniswap pools
		// ETH-DAI: 1 ETH, 200 DAI
		const ethAmount = tenPow18
		let daiAmount = tenPow18.mul(BigNumber.from('200'))

		await weth.connect(adminAccount).deposit({ value: ethAmount })
		await dai.connect(adminAccount).mint(adminAccount.address, daiAmount)
		await weth.connect(adminAccount).approve(router.address, ethAmount)
		await dai.connect(adminAccount).approve(router.address, daiAmount)
		await uniswapFactory.connect(adminAccount).createPair(weth.address, dai.address)
		await router
			.connect(adminAccount)
			.addLiquidity(
				weth.address,
				dai.address,
				ethAmount,
				daiAmount,
				ethAmount,
				daiAmount,
				adminAccount.address,
				BigNumber.from('9999999999999999999')
			)

		// SOME-DAI: 1000 SOME, 100 DAI
		const someAmount = tenPow18.mul(BigNumber.from('1000'))
		daiAmount = tenPow18.mul(BigNumber.from('100'))
		await someToken.connect(adminAccount).mint(adminAccount.address, someAmount)
		await dai.connect(adminAccount).mint(adminAccount.address, daiAmount)

		await someToken.connect(adminAccount).approve(router.address, someAmount)
		await dai.connect(adminAccount).approve(router.address, daiAmount)
		await uniswapFactory.connect(adminAccount).createPair(someToken.address, dai.address)

		await router
			.connect(adminAccount)
			.addLiquidity(
				someToken.address,
				dai.address,
				someAmount,
				daiAmount,
				someAmount,
				daiAmount,
				adminAccount.address,
				BigNumber.from('9999999999999999999')
			)
	})

	it('can buy/sell tokens ETH', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const buyCost = await ideaTokenExchange.getCostForBuyingTokens(ideaToken.address, ideaTokenAmount)
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [weth.address, dai.address]))[0]

		await multiAction.convertAndBuy(
			zeroAddress,
			ideaToken.address,
			ideaTokenAmount,
			ideaTokenAmount,
			requiredInputForCost,
			userAccount.address,
			false,
			{ value: requiredInputForCost }
		)

		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenAmount)).to.be.true

		const sellPrice = await ideaTokenExchange.getPriceForSellingTokens(ideaToken.address, tokenBalanceAfterBuy)
		const outputFromSell = (await router.getAmountsOut(sellPrice, [dai.address, weth.address]))[1]

		await ideaToken.approve(multiAction.address, tokenBalanceAfterBuy)
		await multiAction.sellAndConvert(
			zeroAddress,
			ideaToken.address,
			tokenBalanceAfterBuy,
			outputFromSell,
			userAccount.address
		)

		const tokenBalanceAfterSell = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterSell.eq(BigNumber.from('0'))).to.be.true
	})

	it('can buy/sell tokens WETH', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const buyCost = await ideaTokenExchange.getCostForBuyingTokens(ideaToken.address, ideaTokenAmount)
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [weth.address, dai.address]))[0]

		await weth.deposit({ value: requiredInputForCost })
		await weth.approve(multiAction.address, requiredInputForCost)
		await multiAction.convertAndBuy(
			weth.address,
			ideaToken.address,
			ideaTokenAmount,
			ideaTokenAmount,
			requiredInputForCost,
			userAccount.address,
			false
		)

		const wethBalanceAfterBuy = await weth.balanceOf(userAccount.address)
		expect(wethBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenAmount)).to.be.true

		const sellPrice = await ideaTokenExchange.getPriceForSellingTokens(ideaToken.address, tokenBalanceAfterBuy)
		const outputFromSell = (await router.getAmountsOut(sellPrice, [dai.address, weth.address]))[1]

		await ideaToken.approve(multiAction.address, tokenBalanceAfterBuy)
		await multiAction.sellAndConvert(
			weth.address,
			ideaToken.address,
			tokenBalanceAfterBuy,
			outputFromSell,
			userAccount.address
		)

		const wethBalanceAfterSell = await weth.balanceOf(userAccount.address)
		expect(wethBalanceAfterSell.eq(outputFromSell)).to.be.true
		const tokenBalanceAfterSell = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterSell.eq(BigNumber.from('0'))).to.be.true
	})

	it('can buy/sell tokens SOME', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const buyCost = await ideaTokenExchange.getCostForBuyingTokens(ideaToken.address, ideaTokenAmount)
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [someToken.address, dai.address]))[0]

		await someToken.mint(userAccount.address, requiredInputForCost)
		await someToken.approve(multiAction.address, requiredInputForCost)
		await multiAction.convertAndBuy(
			someToken.address,
			ideaToken.address,
			ideaTokenAmount,
			ideaTokenAmount,
			requiredInputForCost,
			userAccount.address,
			false
		)

		const someBalanceAfterBuy = await someToken.balanceOf(userAccount.address)
		expect(someBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenAmount)).to.be.true

		const sellPrice = await ideaTokenExchange.getPriceForSellingTokens(ideaToken.address, tokenBalanceAfterBuy)
		const outputFromSell = (await router.getAmountsOut(sellPrice, [dai.address, someToken.address]))[1]

		await ideaToken.approve(multiAction.address, tokenBalanceAfterBuy)
		await multiAction.sellAndConvert(
			someToken.address,
			ideaToken.address,
			tokenBalanceAfterBuy,
			outputFromSell,
			userAccount.address
		)

		const someBalanceAfterSell = await someToken.balanceOf(userAccount.address)
		expect(someBalanceAfterSell.eq(outputFromSell)).to.be.true
		const tokenBalanceAfterSell = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterSell.eq(BigNumber.from('0'))).to.be.true
	})

	it('can buy and fallback', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))

		const ideaTokenFallbackAmount = tenPow18.mul(BigNumber.from('24'))
		const buyFallbackCost = await ideaTokenExchange.getCostForBuyingTokens(
			ideaToken.address,
			ideaTokenFallbackAmount
		)
		const requiredInputForFallbackCost = (
			await router.getAmountsIn(buyFallbackCost, [weth.address, dai.address])
		)[0]

		await multiAction.convertAndBuy(
			zeroAddress,
			ideaToken.address,
			ideaTokenAmount,
			ideaTokenFallbackAmount,
			requiredInputForFallbackCost.add(BigNumber.from('1000')),
			userAccount.address,
			false,
			{ value: requiredInputForFallbackCost.add(BigNumber.from('1000')) }
		)

		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenFallbackAmount)).to.be.true
	})

	it('can buy and lock ETH', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const buyCost = await ideaTokenExchange.getCostForBuyingTokens(ideaToken.address, ideaTokenAmount)
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [weth.address, dai.address]))[0]

		await multiAction.convertAndBuy(
			zeroAddress,
			ideaToken.address,
			ideaTokenAmount,
			ideaTokenAmount,
			requiredInputForCost,
			userAccount.address,
			true,
			{ value: requiredInputForCost }
		)

		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		expect((await ideaTokenVault.getLockedAmount(ideaToken.address, userAccount.address)).eq(ideaTokenAmount)).to.be
			.true
	})

	it('can buy and lock DAI', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const buyCost = await ideaTokenExchange.getCostForBuyingTokens(ideaToken.address, ideaTokenAmount)
		await dai.mint(userAccount.address, buyCost)
		await dai.approve(multiAction.address, buyCost)

		await multiAction.buyAndLock(ideaToken.address, ideaTokenAmount, ideaTokenAmount, buyCost, userAccount.address)

		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		expect((await ideaTokenVault.getLockedAmount(ideaToken.address, userAccount.address)).eq(ideaTokenAmount)).to.be
			.true
	})

	it('can buy and lock DAI with fallback', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))

		const ideaTokenFallbackAmount = tenPow18.mul(BigNumber.from('24'))
		const buyFallbackCost = await ideaTokenExchange.getCostForBuyingTokens(
			ideaToken.address,
			ideaTokenFallbackAmount
		)

		await dai.mint(userAccount.address, buyFallbackCost)
		await dai.approve(multiAction.address, buyFallbackCost)

		await multiAction.buyAndLock(
			ideaToken.address,
			ideaTokenAmount,
			ideaTokenFallbackAmount,
			buyFallbackCost,
			userAccount.address
		)

		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		expect(
			(await ideaTokenVault.getLockedAmount(ideaToken.address, userAccount.address)).eq(ideaTokenFallbackAmount)
		).to.be.true
	})

	it('can add and buy', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const marketDetails = await ideaTokenFactory.getMarketDetailsByID(marketID)
		const buyCost = (
			await ideaTokenExchange.getCostsForBuyingTokens(marketDetails, BigNumber.from('0'), ideaTokenAmount)
		)[0]

		await dai.mint(userAccount.address, buyCost)
		await dai.approve(multiAction.address, buyCost)

		const newTokenName = 'sometoken.com'
		await multiAction.addAndBuy(newTokenName, marketID, ideaTokenAmount, userAccount.address, false)

		const id = await ideaTokenFactory.getTokenIDByName(newTokenName, marketID)
		expect(id.eq(BigNumber.from('2'))).to.be.true

		const newTokenAddress = (await ideaTokenFactory.getTokenInfo(marketID, id)).ideaToken
		const newIdeaToken = new ethers.Contract(newTokenAddress, IdeaToken.interface, IdeaToken.signer)

		const tokenBalanceAfterBuy = await newIdeaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenAmount)).to.be.true
	})

	it('can add and buy and lock', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const marketDetails = await ideaTokenFactory.getMarketDetailsByID(marketID)
		const buyCost = (
			await ideaTokenExchange.getCostsForBuyingTokens(marketDetails, BigNumber.from('0'), ideaTokenAmount)
		)[0]

		await dai.mint(userAccount.address, buyCost)
		await dai.approve(multiAction.address, buyCost)

		const newTokenName = 'sometoken.com'
		await multiAction.addAndBuy(newTokenName, marketID, ideaTokenAmount, userAccount.address, true)

		const id = await ideaTokenFactory.getTokenIDByName(newTokenName, marketID)
		expect(id.eq(BigNumber.from('2'))).to.be.true

		const newTokenAddress = (await ideaTokenFactory.getTokenInfo(marketID, id)).ideaToken
		const newIdeaToken = new ethers.Contract(newTokenAddress, IdeaToken.interface, IdeaToken.signer)

		const tokenBalanceAfterBuy = await newIdeaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		expect((await ideaTokenVault.getLockedAmount(newIdeaToken.address, userAccount.address)).eq(ideaTokenAmount)).to
			.be.true
	})

	it('can convert add and buy', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const marketDetails = await ideaTokenFactory.getMarketDetailsByID(marketID)
		const buyCost = (
			await ideaTokenExchange.getCostsForBuyingTokens(marketDetails, BigNumber.from('0'), ideaTokenAmount)
		)[0]
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [weth.address, dai.address]))[0]

		const newTokenName = 'sometoken.com'

		await multiAction.convertAddAndBuy(
			newTokenName,
			marketID,
			zeroAddress,
			ideaTokenAmount,
			ideaTokenAmount,
			requiredInputForCost,
			userAccount.address,
			false,
			{ value: requiredInputForCost }
		)

		const id = await ideaTokenFactory.getTokenIDByName(newTokenName, marketID)
		expect(id.eq(BigNumber.from('2'))).to.be.true

		const newTokenAddress = (await ideaTokenFactory.getTokenInfo(marketID, id)).ideaToken
		const newIdeaToken = new ethers.Contract(newTokenAddress, IdeaToken.interface, IdeaToken.signer)

		const tokenBalanceAfterBuy = await newIdeaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenAmount)).to.be.true
	})

	it('can convert add and buy and fallback', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))

		const ideaTokenFallbackAmount = tenPow18.mul(BigNumber.from('24'))
		const marketDetails = await ideaTokenFactory.getMarketDetailsByID(marketID)
		const buyFallbackCost = (
			await ideaTokenExchange.getCostsForBuyingTokens(marketDetails, BigNumber.from('0'), ideaTokenFallbackAmount)
		)[0]
		const requiredInputForFallbackCost = (
			await router.getAmountsIn(buyFallbackCost, [weth.address, dai.address])
		)[0]

		const newTokenName = 'sometoken.com'

		await multiAction.convertAddAndBuy(
			newTokenName,
			marketID,
			zeroAddress,
			ideaTokenAmount,
			ideaTokenFallbackAmount,
			requiredInputForFallbackCost,
			userAccount.address,
			false,
			{ value: requiredInputForFallbackCost }
		)

		const id = await ideaTokenFactory.getTokenIDByName(newTokenName, marketID)
		expect(id.eq(BigNumber.from('2'))).to.be.true

		const newTokenAddress = (await ideaTokenFactory.getTokenInfo(marketID, id)).ideaToken
		const newIdeaToken = new ethers.Contract(newTokenAddress, IdeaToken.interface, IdeaToken.signer)

		const tokenBalanceAfterBuy = await newIdeaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenFallbackAmount)).to.be.true
	})

	it('can convert add and buy and lock', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const marketDetails = await ideaTokenFactory.getMarketDetailsByID(marketID)
		const buyCost = (
			await ideaTokenExchange.getCostsForBuyingTokens(marketDetails, BigNumber.from('0'), ideaTokenAmount)
		)[0]
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [weth.address, dai.address]))[0]

		const newTokenName = 'sometoken.com'

		await multiAction.convertAddAndBuy(
			newTokenName,
			marketID,
			zeroAddress,
			ideaTokenAmount,
			ideaTokenAmount,
			requiredInputForCost,
			userAccount.address,
			true,
			{ value: requiredInputForCost }
		)

		const id = await ideaTokenFactory.getTokenIDByName(newTokenName, marketID)
		expect(id.eq(BigNumber.from('2'))).to.be.true

		const newTokenAddress = (await ideaTokenFactory.getTokenInfo(marketID, id)).ideaToken
		const newIdeaToken = new ethers.Contract(newTokenAddress, IdeaToken.interface, IdeaToken.signer)

		const tokenBalanceAfterBuy = await newIdeaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		expect((await ideaTokenVault.getLockedAmount(newIdeaToken.address, userAccount.address)).eq(ideaTokenAmount)).to
			.be.true
	})

	it('fail buy cost too high', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const buyCost = await ideaTokenExchange.getCostForBuyingTokens(ideaToken.address, ideaTokenAmount)
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [someToken.address, dai.address]))[0]

		expect(
			multiAction.convertAndBuy(
				someToken.address,
				ideaToken.address,
				ideaTokenAmount,
				ideaTokenAmount,
				requiredInputForCost.sub(BigNumber.from('1')),
				userAccount.address,
				false
			)
		).to.be.revertedWith('')
	})

	it('fail sell price too low', async () => {
		const ideaTokenAmount = tenPow18.mul(BigNumber.from('25'))
		const buyCost = await ideaTokenExchange.getCostForBuyingTokens(ideaToken.address, ideaTokenAmount)
		const requiredInputForCost = (await router.getAmountsIn(buyCost, [someToken.address, dai.address]))[0]

		await someToken.mint(userAccount.address, requiredInputForCost)
		await someToken.approve(multiAction.address, requiredInputForCost)
		await multiAction.convertAndBuy(
			someToken.address,
			ideaToken.address,
			ideaTokenAmount,
			ideaTokenAmount,
			requiredInputForCost,
			userAccount.address,
			false
		)

		const someBalanceAfterBuy = await someToken.balanceOf(userAccount.address)
		expect(someBalanceAfterBuy.eq(BigNumber.from('0'))).to.be.true
		const tokenBalanceAfterBuy = await ideaToken.balanceOf(userAccount.address)
		expect(tokenBalanceAfterBuy.eq(ideaTokenAmount)).to.be.true

		const sellPrice = await ideaTokenExchange.getPriceForSellingTokens(ideaToken.address, tokenBalanceAfterBuy)
		const outputFromSell = (await router.getAmountsOut(sellPrice, [dai.address, someToken.address]))[1]

		await ideaToken.approve(multiAction.address, tokenBalanceAfterBuy)
		expect(
			multiAction.sellAndConvert(
				someToken.address,
				ideaToken.address,
				tokenBalanceAfterBuy,
				outputFromSell.add(BigNumber.from('1')),
				userAccount.address
			)
		).to.be.revertedWith('sellAndConvert: slippage too high')
	})

	it('fail directly send ETH', async () => {
		expect(
			userAccount.sendTransaction({
				to: multiAction.address,
				value: tenPow18,
			})
		).to.be.revertedWith('')
	})
})