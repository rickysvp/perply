// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PerplyArena {
    uint8 public constant SIDE_LONG = 0;
    uint8 public constant SIDE_SHORT = 1;
    uint16 public constant BPS = 10_000;
    int256 private constant PRECISION = 1e18;

    struct Position {
        uint256 margin;
        uint256 weight;
        uint32 leverage;
        uint64 entryPriceE8;
        int256 entryAccPnlPerWeight;
        bool isOpen;
    }

    struct PositionView {
        uint256 margin;
        uint256 weight;
        uint32 leverage;
        uint64 entryPriceE8;
        bool isOpen;
        int256 pnl;
        int256 equity;
        uint256 maintenanceMargin;
    }

    address public owner;
    address public keeper;

    uint256 public markPriceE8;
    uint256 public lastSettlementAt;

    uint32 public minSettlementInterval;
    uint16 public volatilityTriggerBps;
    uint16 public settlementStrengthBps;
    uint16 public maxSettlementTransferBps;

    uint16 public openFeeBps;
    uint16 public closeFeeBps;
    uint16 public settlementFeeBps;

    uint16 public congestionStartBps;
    uint16 public congestionFullBps;
    uint16 public maxCongestionFeeBps;

    uint16 public maintenanceBaseBps;
    uint16 public maintenanceLeverageBps;
    uint16 public liquidationPenaltyBps;
    uint16 public liquidatorRewardShareBps;

    uint256 public treasuryBalance;
    uint256 public insuranceFund;

    mapping(address => uint256) public availableBalance;
    mapping(address => mapping(uint8 => Position)) private positions;

    uint256[2] public sideWeight;
    uint256[2] public sideMargin;
    int256[2] public accPnlPerWeight;
    uint256[2] public cumulativeCongestionRewards;

    error OnlyOwner();
    error UnauthorizedKeeper();
    error InvalidSide();
    error InvalidAmount();
    error InvalidPrice();
    error InvalidLeverage();
    error PositionExists();
    error PositionMissing();
    error InsufficientBalance();
    error SettlementTooEarly();
    error NotLiquidatable();
    error TransferFailed();

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event KeeperUpdated(address indexed newKeeper);
    event MarkPriceUpdated(uint256 oldPriceE8, uint256 newPriceE8);
    event ParamsUpdated();

    event Deposited(address indexed trader, uint256 amount, uint256 newAvailableBalance);
    event Withdrawn(address indexed trader, uint256 amount, uint256 newAvailableBalance);

    event PositionOpened(
        address indexed trader,
        uint8 indexed side,
        uint256 margin,
        uint32 leverage,
        uint256 weight,
        uint256 openFee,
        uint16 congestionRateBps,
        uint256 congestionFee,
        uint256 congestionToOpposite,
        uint256 congestionToTreasury
    );

    event PositionClosed(
        address indexed trader,
        uint8 indexed side,
        uint256 margin,
        uint256 weight,
        uint32 leverage,
        int256 pnl,
        int256 equityBeforeFees,
        uint256 closeFee,
        uint256 payout
    );

    event PositionLiquidated(
        address indexed trader,
        address indexed liquidator,
        uint8 indexed side,
        int256 pnl,
        int256 equityBeforePenalty,
        uint256 liquidationPenalty,
        uint256 liquidatorReward,
        uint256 insuranceReward,
        uint256 traderPayout
    );

    event Settled(
        uint256 oldPriceE8,
        uint256 newPriceE8,
        uint8 winnerSide,
        uint8 loserSide,
        uint256 grossTransfer,
        uint256 settlementFee,
        uint256 winnerNet,
        uint256 matchedWeight
    );

    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event InsuranceWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(uint256 initialPriceE8) {
        if (initialPriceE8 == 0) revert InvalidPrice();

        owner = msg.sender;
        keeper = msg.sender;

        markPriceE8 = initialPriceE8;
        lastSettlementAt = block.timestamp;

        minSettlementInterval = 10;
        volatilityTriggerBps = 15; // 0.15%
        settlementStrengthBps = 8000; // k = 0.8
        maxSettlementTransferBps = 3000; // max 30% of losing side margin per tick

        openFeeBps = 100; // 1%
        closeFeeBps = 100; // 1%
        settlementFeeBps = 1; // 0.01%

        congestionStartBps = 1000; // starts when imbalance >10%
        congestionFullBps = 5000; // reaches max when imbalance >=50%
        maxCongestionFeeBps = 50; // 0.5%

        maintenanceBaseBps = 600; // 6% of margin
        maintenanceLeverageBps = 40; // +0.4% * leverage
        liquidationPenaltyBps = 200; // 2%
        liquidatorRewardShareBps = 5000; // 50% of penalty to liquidator
    }

    receive() external payable {
        _deposit(msg.sender, msg.value);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAmount();
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function setKeeper(address newKeeper) external onlyOwner {
        keeper = newKeeper;
        emit KeeperUpdated(newKeeper);
    }

    function setRiskParams(
        uint32 newMinSettlementInterval,
        uint16 newVolatilityTriggerBps,
        uint16 newSettlementStrengthBps,
        uint16 newMaxSettlementTransferBps,
        uint16 newOpenFeeBps,
        uint16 newCloseFeeBps,
        uint16 newSettlementFeeBps,
        uint16 newCongestionStartBps,
        uint16 newCongestionFullBps,
        uint16 newMaxCongestionFeeBps,
        uint16 newMaintenanceBaseBps,
        uint16 newMaintenanceLeverageBps,
        uint16 newLiquidationPenaltyBps,
        uint16 newLiquidatorRewardShareBps
    ) external onlyOwner {
        if (newSettlementStrengthBps > BPS) revert InvalidAmount();
        if (newMaxSettlementTransferBps == 0 || newMaxSettlementTransferBps > BPS) revert InvalidAmount();
        if (newSettlementFeeBps > 100) revert InvalidAmount(); // <=1%
        if (newCongestionStartBps >= newCongestionFullBps) revert InvalidAmount();
        if (newMaxCongestionFeeBps > 2000) revert InvalidAmount(); // <=20%
        if (newLiquidatorRewardShareBps > BPS) revert InvalidAmount();

        minSettlementInterval = newMinSettlementInterval;
        volatilityTriggerBps = newVolatilityTriggerBps;
        settlementStrengthBps = newSettlementStrengthBps;
        maxSettlementTransferBps = newMaxSettlementTransferBps;

        openFeeBps = newOpenFeeBps;
        closeFeeBps = newCloseFeeBps;
        settlementFeeBps = newSettlementFeeBps;

        congestionStartBps = newCongestionStartBps;
        congestionFullBps = newCongestionFullBps;
        maxCongestionFeeBps = newMaxCongestionFeeBps;

        maintenanceBaseBps = newMaintenanceBaseBps;
        maintenanceLeverageBps = newMaintenanceLeverageBps;
        liquidationPenaltyBps = newLiquidationPenaltyBps;
        liquidatorRewardShareBps = newLiquidatorRewardShareBps;

        emit ParamsUpdated();
    }

    function deposit() external payable {
        _deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        if (availableBalance[msg.sender] < amount) revert InsufficientBalance();

        availableBalance[msg.sender] -= amount;
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(msg.sender, amount, availableBalance[msg.sender]);
    }

    function previewOpen(uint8 side, uint256 margin, uint32 leverage)
        external
        view
        returns (
            uint256 openFee,
            uint16 congestionRateBps,
            uint256 congestionFee,
            uint256 congestionToOpposite,
            uint256 congestionToTreasury,
            uint256 totalRequired
        )
    {
        if (side > SIDE_SHORT) revert InvalidSide();
        if (margin == 0) revert InvalidAmount();
        if (leverage < 2 || leverage > 100) revert InvalidLeverage();

        openFee = (margin * openFeeBps) / BPS;
        congestionRateBps = _congestionRateBps(side);
        congestionFee = (margin * congestionRateBps) / BPS;
        congestionToOpposite = (congestionFee * 8000) / BPS;
        congestionToTreasury = congestionFee - congestionToOpposite;
        totalRequired = margin + openFee + congestionFee;
    }

    function openPosition(uint8 side, uint256 margin, uint32 leverage) external {
        if (side > SIDE_SHORT) revert InvalidSide();
        if (margin == 0) revert InvalidAmount();
        if (leverage < 2 || leverage > 100) revert InvalidLeverage();
        if (positions[msg.sender][side].isOpen) revert PositionExists();

        uint256 openFee = (margin * openFeeBps) / BPS;
        uint16 congestionRate = _congestionRateBps(side);
        uint256 congestionFee = (margin * congestionRate) / BPS;
        uint256 totalRequired = margin + openFee + congestionFee;
        if (availableBalance[msg.sender] < totalRequired) revert InsufficientBalance();

        availableBalance[msg.sender] -= totalRequired;

        treasuryBalance += openFee;
        uint256 congestionToOpposite = (congestionFee * 8000) / BPS;
        uint256 congestionToTreasury = congestionFee - congestionToOpposite;

        uint8 opposite = _opposite(side);
        if (congestionToOpposite > 0 && sideWeight[opposite] > 0) {
            _applySideDelta(opposite, int256(congestionToOpposite));
            cumulativeCongestionRewards[opposite] += congestionToOpposite;
        } else {
            congestionToTreasury += congestionToOpposite;
            congestionToOpposite = 0;
        }
        treasuryBalance += congestionToTreasury;

        uint256 weight = margin * leverage;
        positions[msg.sender][side] = Position({
            margin: margin,
            weight: weight,
            leverage: leverage,
            entryPriceE8: uint64(markPriceE8),
            entryAccPnlPerWeight: accPnlPerWeight[side],
            isOpen: true
        });

        sideWeight[side] += weight;
        sideMargin[side] += margin;

        emit PositionOpened(
            msg.sender,
            side,
            margin,
            leverage,
            weight,
            openFee,
            congestionRate,
            congestionFee,
            congestionToOpposite,
            congestionToTreasury
        );
    }

    function closePosition(uint8 side) external {
        _closePosition(msg.sender, side);
    }

    function liquidate(address trader, uint8 side) external {
        if (side > SIDE_SHORT) revert InvalidSide();
        Position memory pos = positions[trader][side];
        if (!pos.isOpen) revert PositionMissing();

        int256 pnl = _positionPnl(pos, side);
        int256 equitySigned = int256(pos.margin) + pnl;
        uint256 maintenance = _maintenanceMargin(pos);

        if (equitySigned > int256(maintenance)) revert NotLiquidatable();

        _removePosition(trader, side, pos);

        uint256 payout = 0;
        uint256 liquidationPenalty = 0;
        uint256 liquidatorReward = 0;
        uint256 insuranceReward = 0;

        if (equitySigned > 0) {
            uint256 equity = uint256(equitySigned);
            liquidationPenalty = (equity * liquidationPenaltyBps) / BPS;
            if (liquidationPenalty > equity) liquidationPenalty = equity;
            liquidatorReward = (liquidationPenalty * liquidatorRewardShareBps) / BPS;
            insuranceReward = liquidationPenalty - liquidatorReward;
            payout = equity - liquidationPenalty;

            if (payout > 0) {
                availableBalance[trader] += payout;
            }
            if (liquidatorReward > 0) {
                availableBalance[msg.sender] += liquidatorReward;
            }
            if (insuranceReward > 0) {
                insuranceFund += insuranceReward;
            }
        } else if (equitySigned < 0) {
            _coverBadDebt(uint256(-equitySigned));
        }

        emit PositionLiquidated(
            trader,
            msg.sender,
            side,
            pnl,
            equitySigned,
            liquidationPenalty,
            liquidatorReward,
            insuranceReward,
            payout
        );
    }

    function settleWithPrice(uint256 newPriceE8) external {
        if (msg.sender != keeper && msg.sender != owner) revert UnauthorizedKeeper();
        if (newPriceE8 == 0) revert InvalidPrice();

        uint256 oldPrice = markPriceE8;
        if (oldPrice == 0) revert InvalidPrice();

        uint256 absDelta = newPriceE8 > oldPrice ? newPriceE8 - oldPrice : oldPrice - newPriceE8;
        uint256 deltaBps = (absDelta * BPS) / oldPrice;

        bool intervalElapsed = block.timestamp >= lastSettlementAt + minSettlementInterval;
        if (!intervalElapsed && deltaBps < volatilityTriggerBps) {
            revert SettlementTooEarly();
        }

        uint8 winnerSide = 255;
        uint8 loserSide = 255;
        uint256 matchedWeight = 0;
        uint256 grossTransfer = 0;
        uint256 settlementFee = 0;
        uint256 winnerNet = 0;

        if (newPriceE8 != oldPrice && sideWeight[SIDE_LONG] > 0 && sideWeight[SIDE_SHORT] > 0) {
            winnerSide = newPriceE8 > oldPrice ? SIDE_LONG : SIDE_SHORT;
            loserSide = winnerSide == SIDE_LONG ? SIDE_SHORT : SIDE_LONG;

            matchedWeight = _min(sideWeight[SIDE_LONG], sideWeight[SIDE_SHORT]);
            uint256 rawTransfer = (matchedWeight * absDelta * settlementStrengthBps) / oldPrice / BPS;

            uint256 capTransfer = (sideMargin[loserSide] * maxSettlementTransferBps) / BPS;
            grossTransfer = _min(rawTransfer, capTransfer);

            if (grossTransfer > 0) {
                settlementFee = (grossTransfer * settlementFeeBps) / BPS;
                winnerNet = grossTransfer - settlementFee;

                _applySideDelta(winnerSide, int256(winnerNet));
                _applySideDelta(loserSide, -int256(grossTransfer));
                treasuryBalance += settlementFee;
            }
        }

        markPriceE8 = newPriceE8;
        lastSettlementAt = block.timestamp;
        emit MarkPriceUpdated(oldPrice, newPriceE8);
        emit Settled(
            oldPrice,
            newPriceE8,
            winnerSide,
            loserSide,
            grossTransfer,
            settlementFee,
            winnerNet,
            matchedWeight
        );
    }

    function getPosition(address trader, uint8 side) external view returns (PositionView memory pv) {
        if (side > SIDE_SHORT) revert InvalidSide();
        Position memory pos = positions[trader][side];
        if (!pos.isOpen) {
            return pv;
        }

        int256 pnl = _positionPnl(pos, side);
        int256 equity = int256(pos.margin) + pnl;

        pv = PositionView({
            margin: pos.margin,
            weight: pos.weight,
            leverage: pos.leverage,
            entryPriceE8: pos.entryPriceE8,
            isOpen: true,
            pnl: pnl,
            equity: equity,
            maintenanceMargin: _maintenanceMargin(pos)
        });
    }

    function getCongestionRatesBps() external view returns (uint16 longRate, uint16 shortRate) {
        longRate = _congestionRateBps(SIDE_LONG);
        shortRate = _congestionRateBps(SIDE_SHORT);
    }

    function getAccount(address trader)
        external
        view
        returns (uint256 available, uint256 locked, PositionView memory longPos, PositionView memory shortPos)
    {
        available = availableBalance[trader];

        Position memory pLong = positions[trader][SIDE_LONG];
        if (pLong.isOpen) {
            locked += pLong.margin;
        }
        Position memory pShort = positions[trader][SIDE_SHORT];
        if (pShort.isOpen) {
            locked += pShort.margin;
        }

        longPos = this.getPosition(trader, SIDE_LONG);
        shortPos = this.getPosition(trader, SIDE_SHORT);
    }

    function withdrawTreasury(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0) || amount == 0 || amount > treasuryBalance) revert InvalidAmount();
        treasuryBalance -= amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit TreasuryWithdrawn(to, amount);
    }

    function withdrawInsurance(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0) || amount == 0 || amount > insuranceFund) revert InvalidAmount();
        insuranceFund -= amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit InsuranceWithdrawn(to, amount);
    }

    function _closePosition(address trader, uint8 side) internal {
        if (side > SIDE_SHORT) revert InvalidSide();
        Position memory pos = positions[trader][side];
        if (!pos.isOpen) revert PositionMissing();

        int256 pnl = _positionPnl(pos, side);
        int256 equitySigned = int256(pos.margin) + pnl;

        _removePosition(trader, side, pos);

        uint256 closeFee = 0;
        uint256 payout = 0;

        if (equitySigned > 0) {
            uint256 equity = uint256(equitySigned);
            closeFee = (equity * closeFeeBps) / BPS;
            if (closeFee > equity) closeFee = equity;
            payout = equity - closeFee;
            treasuryBalance += closeFee;
            if (payout > 0) {
                availableBalance[trader] += payout;
            }
        } else if (equitySigned < 0) {
            _coverBadDebt(uint256(-equitySigned));
        }

        emit PositionClosed(
            trader,
            side,
            pos.margin,
            pos.weight,
            pos.leverage,
            pnl,
            equitySigned,
            closeFee,
            payout
        );
    }

    function _removePosition(address trader, uint8 side, Position memory pos) internal {
        sideWeight[side] -= pos.weight;
        sideMargin[side] -= pos.margin;
        delete positions[trader][side];
    }

    function _positionPnl(Position memory pos, uint8 side) internal view returns (int256) {
        int256 deltaAcc = accPnlPerWeight[side] - pos.entryAccPnlPerWeight;
        return (int256(pos.weight) * deltaAcc) / PRECISION;
    }

    function _maintenanceMargin(Position memory pos) internal view returns (uint256) {
        uint256 mmrBps = uint256(maintenanceBaseBps) + uint256(maintenanceLeverageBps) * pos.leverage;
        return (pos.margin * mmrBps) / BPS;
    }

    function _congestionRateBps(uint8 side) internal view returns (uint16) {
        uint256 current = sideWeight[side];
        uint256 other = sideWeight[_opposite(side)];
        if (current <= other) return 0;

        uint256 total = current + other;
        if (total == 0) return 0;

        uint256 imbalanceBps = ((current - other) * BPS) / total;
        if (imbalanceBps <= congestionStartBps) return 0;
        if (imbalanceBps >= congestionFullBps) return maxCongestionFeeBps;

        uint256 span = congestionFullBps - congestionStartBps;
        return uint16((uint256(maxCongestionFeeBps) * (imbalanceBps - congestionStartBps)) / span);
    }

    function _applySideDelta(uint8 side, int256 amount) internal {
        if (amount == 0) return;
        uint256 weight = sideWeight[side];

        if (weight == 0) {
            if (amount > 0) {
                treasuryBalance += uint256(amount);
            }
            return;
        }

        int256 perWeight = (amount * PRECISION) / int256(weight);
        accPnlPerWeight[side] += perWeight;
    }

    function _coverBadDebt(uint256 debt) internal {
        if (debt == 0) return;
        if (insuranceFund >= debt) {
            insuranceFund -= debt;
            return;
        }

        uint256 remaining = debt - insuranceFund;
        insuranceFund = 0;

        if (treasuryBalance >= remaining) {
            treasuryBalance -= remaining;
            return;
        }
        treasuryBalance = 0;
    }

    function _deposit(address trader, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        availableBalance[trader] += amount;
        emit Deposited(trader, amount, availableBalance[trader]);
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a <= b ? a : b;
    }

    function _opposite(uint8 side) internal pure returns (uint8) {
        return side == SIDE_LONG ? SIDE_SHORT : SIDE_LONG;
    }
}
