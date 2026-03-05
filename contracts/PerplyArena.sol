// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PerplyArena {
    uint8 public constant SIDE_LONG = 0;
    uint8 public constant SIDE_SHORT = 1;
    uint16 public constant BPS_DENOMINATOR = 10_000;

    struct Position {
        uint256 margin;
        uint32 leverage;
        uint64 entryPriceE8;
        bool isOpen;
    }

    address public owner;
    uint256 public markPriceE8;
    uint32 public maxLeverage;
    uint16 public feeBps;
    uint256 public protocolFees;

    mapping(address => uint256) public availableBalance;
    mapping(address => uint256) public lockedMargin;
    mapping(address => mapping(uint8 => Position)) private positions;

    error OnlyOwner();
    error InvalidSide();
    error InvalidPrice();
    error InvalidAmount();
    error InvalidLeverage();
    error PositionExists();
    error PositionMissing();
    error InsufficientBalance();
    error TransferFailed();

    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event MarkPriceUpdated(uint256 oldPriceE8, uint256 newPriceE8);
    event RiskParamsUpdated(uint32 maxLeverage, uint16 feeBps);

    event Deposited(address indexed trader, uint256 amount, uint256 newAvailableBalance);
    event Withdrawn(address indexed trader, uint256 amount, uint256 newAvailableBalance);
    event PositionOpened(
        address indexed trader,
        uint8 indexed side,
        uint256 margin,
        uint32 leverage,
        uint64 entryPriceE8,
        uint256 feePaid
    );
    event PositionClosed(
        address indexed trader,
        uint8 indexed side,
        uint256 margin,
        uint32 leverage,
        uint64 entryPriceE8,
        uint64 exitPriceE8,
        int256 pnl,
        uint256 settlement
    );
    event ProtocolFeesWithdrawn(address indexed to, uint256 amount);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor(uint256 initialPriceE8) {
        if (initialPriceE8 == 0) revert InvalidPrice();
        owner = msg.sender;
        markPriceE8 = initialPriceE8;
        maxLeverage = 20;
        feeBps = 10; // 0.1%
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

    function setMarkPrice(uint256 newPriceE8) external onlyOwner {
        if (newPriceE8 == 0) revert InvalidPrice();
        uint256 oldPrice = markPriceE8;
        markPriceE8 = newPriceE8;
        emit MarkPriceUpdated(oldPrice, newPriceE8);
    }

    function setRiskParams(uint32 newMaxLeverage, uint16 newFeeBps) external onlyOwner {
        if (newMaxLeverage < 2 || newMaxLeverage > 100) revert InvalidLeverage();
        if (newFeeBps > 1000) revert InvalidAmount(); // <=10%
        maxLeverage = newMaxLeverage;
        feeBps = newFeeBps;
        emit RiskParamsUpdated(newMaxLeverage, newFeeBps);
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

    function openPosition(uint8 side, uint256 margin, uint32 leverage) external {
        if (side > SIDE_SHORT) revert InvalidSide();
        if (margin == 0) revert InvalidAmount();
        if (leverage < 2 || leverage > maxLeverage) revert InvalidLeverage();
        if (positions[msg.sender][side].isOpen) revert PositionExists();

        uint256 fee = (margin * leverage * feeBps) / BPS_DENOMINATOR;
        uint256 totalRequired = margin + fee;
        if (availableBalance[msg.sender] < totalRequired) revert InsufficientBalance();

        availableBalance[msg.sender] -= totalRequired;
        lockedMargin[msg.sender] += margin;
        protocolFees += fee;

        positions[msg.sender][side] = Position({
            margin: margin,
            leverage: leverage,
            entryPriceE8: uint64(markPriceE8),
            isOpen: true
        });

        emit PositionOpened(msg.sender, side, margin, leverage, uint64(markPriceE8), fee);
    }

    function closePosition(uint8 side) external {
        if (side > SIDE_SHORT) revert InvalidSide();
        Position memory position = positions[msg.sender][side];
        if (!position.isOpen) revert PositionMissing();

        int256 pnl = _calculatePnl(position, side, markPriceE8);
        int256 maxLoss = -int256(position.margin);
        if (pnl < maxLoss) pnl = maxLoss;

        int256 settlementSigned = int256(position.margin) + pnl;
        uint256 settlement = settlementSigned > 0 ? uint256(settlementSigned) : 0;

        lockedMargin[msg.sender] -= position.margin;
        availableBalance[msg.sender] += settlement;

        delete positions[msg.sender][side];

        emit PositionClosed(
            msg.sender,
            side,
            position.margin,
            position.leverage,
            position.entryPriceE8,
            uint64(markPriceE8),
            pnl,
            settlement
        );
    }

    function withdrawProtocolFees(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert InvalidAmount();
        if (amount == 0 || amount > protocolFees) revert InvalidAmount();
        protocolFees -= amount;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
        emit ProtocolFeesWithdrawn(to, amount);
    }

    function getPosition(address trader, uint8 side) external view returns (Position memory) {
        if (side > SIDE_SHORT) revert InvalidSide();
        return positions[trader][side];
    }

    function getAccount(address trader)
        external
        view
        returns (uint256 available, uint256 locked, Position memory longPos, Position memory shortPos)
    {
        available = availableBalance[trader];
        locked = lockedMargin[trader];
        longPos = positions[trader][SIDE_LONG];
        shortPos = positions[trader][SIDE_SHORT];
    }

    function _deposit(address trader, uint256 amount) internal {
        if (amount == 0) revert InvalidAmount();
        availableBalance[trader] += amount;
        emit Deposited(trader, amount, availableBalance[trader]);
    }

    function _calculatePnl(Position memory position, uint8 side, uint256 exitPriceE8)
        internal
        pure
        returns (int256)
    {
        int256 notional = int256(position.margin * uint256(position.leverage));
        int256 priceDelta = int256(exitPriceE8) - int256(uint256(position.entryPriceE8));
        if (side == SIDE_SHORT) {
            priceDelta = -priceDelta;
        }
        return (notional * priceDelta) / int256(uint256(position.entryPriceE8));
    }
}
